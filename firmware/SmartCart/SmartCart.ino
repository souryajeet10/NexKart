#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <HX711.h>
#include <LiquidCrystal_I2C.h>
#include <MFRC522.h>
#include <Preferences.h>
#include <SPI.h>
#include <WiFi.h>
#include <Wire.h>
#include <math.h>
#include <esp_system.h>
#include "config.h"

HX711 scale;
MFRC522 reader(RFID_SS, RFID_RST);
LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);
Preferences preferences;
QueueHandle_t snapshots, replies;
struct Scan { char uid[21]; uint32_t sequence; };
struct SensorFrame {
  float grams;
  bool ready;
  bool setupScale;
  Scan scan;
  char ack[40];
};
struct Reply {
  bool warning;
  uint32_t beep;
  uint32_t scanAck;
  char text[45];
  char command[40];
  char kind[12];
  float value;
};

char bootId[17];
SensorFrame frame{};
Scan heldScan{};
uint32_t lastTagTime = 0, sequence = 0;
char lastUid[21] = "";
uint32_t lastSample = 0, lastReply = 0, lastLcd = 0, beepUntil = 0;
bool gotSample = false, gotReply = false, warning = false, haveBeep = false;
uint32_t lastBeep = 0;
char displayText[45] = "Starting Wi-Fi";
char tareCommand[40] = "";
int tareRemaining = 0;
int64_t tareTotal = 0;
bool haveOffset = false;
bool calibrated = false;
float factor = INITIAL_COUNTS_PER_GRAM;

void copyText(char *out, size_t size, const char *in) {
  snprintf(out, size, "%s", in);
}

// HTTP may wait on a LAN connection. Keep it in its own task so RFID,
// LCD, scale sampling and buzzer timing continue on the Arduino loop.
void networkTask(void *) {
  uint32_t lastReconnect = millis();
  while (true) {
    if (WiFi.status() != WL_CONNECTED) {
      if (millis() - lastReconnect >= 4000) {
        WiFi.reconnect();
        lastReconnect = millis();
      }
    } else {
      SensorFrame current{};
      if (xQueuePeek(snapshots, &current, 0) == pdTRUE) {
        WiFiClient wifi;
        HTTPClient http;
        if (http.begin(wifi, SERVER_URL)) {
          http.setConnectTimeout(450);
          http.setTimeout(650);
          http.addHeader("Content-Type", "application/json");
          http.addHeader("Authorization", String("Bearer ") + DEVICE_KEY);
          JsonDocument request;
          request["id"] = DEVICE_ID;
          request["boot"] = bootId;
          request["setupScale"] = current.setupScale;
          if (current.ready) request["grams"] = current.grams;
          else request["grams"] = nullptr;
          if (current.ack[0]) request["ack"] = current.ack;
          if (current.scan.sequence) {
            request["scan"]["uid"] = current.scan.uid;
            request["scan"]["event"] = String(current.scan.sequence);
          }
          String payload;
          serializeJson(request, payload);
          if (http.POST(payload) == 200) {
            JsonDocument response;
            if (!deserializeJson(response, http.getString())) {
              Reply next{};
              next.warning = response["alert"] | false;
              next.beep = response["beep"] | 0;
              next.scanAck = current.scan.sequence;
              const char *scanError = response["scan"]["error"] | "";
              copyText(next.text, sizeof(next.text), scanError[0] ? "Scan rejected" : (response["text"] | ""));
              copyText(next.command, sizeof(next.command), response["command"]["id"] | "");
              copyText(next.kind, sizeof(next.kind), response["command"]["kind"] | "");
              next.value = response["command"]["value"] | 0.0f;
              xQueueOverwrite(replies, &next);
            }
          }
          http.end();
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(140));
  }
}

void handleReply(uint32_t now) {
  Reply reply{};
  if (xQueueReceive(replies, &reply, 0) != pdTRUE) return;
  lastReply = now;
  gotReply = true;
  warning = reply.warning;
  copyText(displayText, sizeof(displayText), reply.text);
  if (haveBeep && lastBeep != reply.beep) beepUntil = now + 120;
  lastBeep = reply.beep;
  haveBeep = true;
  if (heldScan.sequence == reply.scanAck) heldScan.sequence = 0;
  if (!reply.command[0] || !strcmp(frame.ack, reply.command) || tareRemaining) return;
  if (!strcmp(reply.kind, "tare")) {
    copyText(tareCommand, sizeof(tareCommand), reply.command);
    tareRemaining = 12;
    tareTotal = 0;
  } else if (!strcmp(reply.kind, "calibrate") && isfinite(reply.value) && reply.value != 0) {
    factor = reply.value;
    calibrated = true;
    scale.set_scale(factor);
    preferences.putFloat("factor", factor);
    gotSample = false;
    copyText(frame.ack, sizeof(frame.ack), reply.command);
  }
}

void sampleScale(uint32_t now) {
  if (!scale.is_ready()) return;
  const long raw = scale.read();
  if (tareRemaining) {
    tareTotal += raw;
    if (--tareRemaining == 0) {
      const long offset = static_cast<long>(tareTotal / 12);
      scale.set_offset(offset);
      preferences.putLong("offset", offset);
      haveOffset = true;
      copyText(frame.ack, sizeof(frame.ack), tareCommand);
    }
    return;
  }
  lastSample = now;
  gotSample = true;
  frame.grams = haveOffset ? (raw - scale.get_offset()) / (calibrated ? factor : 1.0f) : 0.0f;
}

void pollTag(uint32_t now) {
  if (!gotReply || now - lastReply > 2300 || heldScan.sequence) return;
  if (!reader.PICC_IsNewCardPresent() || !reader.PICC_ReadCardSerial()) return;
  char uid[21] = "";
  for (byte i = 0; i < reader.uid.size && i < 10; i++) {
    snprintf(uid + i * 2, sizeof(uid) - i * 2, "%02X", reader.uid.uidByte[i]);
  }
  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
  if (!strcmp(lastUid, uid) && now - lastTagTime < 2500) return;
  lastTagTime = now;
  copyText(lastUid, sizeof(lastUid), uid);
  copyText(heldScan.uid, sizeof(heldScan.uid), uid);
  heldScan.sequence = ++sequence;
}

void lcdLine(int row, const char *text) {
  char padded[17];
  snprintf(padded, sizeof(padded), "%-16.16s", text);
  lcd.setCursor(0, row);
  lcd.print(padded);
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER, OUTPUT);
  digitalWrite(BUZZER, BUZZER_ACTIVE_HIGH ? LOW : HIGH);
  SPI.begin(RFID_SCK, RFID_MISO, RFID_MOSI, RFID_SS);
  reader.PCD_Init();
  Wire.begin(I2C_SDA, I2C_SCL);
  lcd.init();
  lcd.backlight();
  lcdLine(0, "SmartCart SC-01");
  scale.begin(HX_DOUT, HX_SCK);
  preferences.begin("smartcart");
  calibrated = preferences.isKey("factor") || INITIAL_FACTOR_CALIBRATED;
  factor = preferences.getFloat("factor", INITIAL_COUNTS_PER_GRAM);
  scale.set_scale(factor);
  haveOffset = preferences.isKey("offset");
  if (haveOffset) scale.set_offset(preferences.getLong("offset"));
  snprintf(bootId, sizeof(bootId), "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
  snapshots = xQueueCreate(1, sizeof(SensorFrame));
  replies = xQueueCreate(1, sizeof(Reply));
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  xTaskCreate(networkTask, "smartcart-net", 8192, nullptr, 1, nullptr);
}

void loop() {
  const uint32_t now = millis();
  handleReply(now);
  sampleScale(now);
  const bool online = gotReply && now - lastReply <= 2300;
  frame.setupScale = gotSample && !tareRemaining && now - lastSample <= 450 && (!calibrated || !haveOffset);
  frame.ready = gotSample && !tareRemaining && now - lastSample <= 450 && calibrated && haveOffset;
  if (frame.ready) pollTag(now);
  frame.scan = heldScan;
  xQueueOverwrite(snapshots, &frame);
  const bool sounding = online && (warning ? now % 700 < 160 : static_cast<int32_t>(beepUntil - now) > 0);
  digitalWrite(BUZZER, sounding == BUZZER_ACTIVE_HIGH ? HIGH : LOW);
  if (now - lastLcd >= 250) {
    lastLcd = now;
    lcdLine(0, online ? displayText : "Server offline");
    char weight[17];
    snprintf(weight, sizeof(weight), "%6.0f g", frame.grams);
    lcdLine(1, frame.ready ? weight : frame.setupScale ? "Setup required" : "Scale waiting");
    if (frame.setupScale && haveOffset) Serial.printf("Net raw counts: %.0f\n", frame.grams);
  }
  delay(5);
}
