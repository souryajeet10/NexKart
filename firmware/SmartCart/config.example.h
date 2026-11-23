#pragma once

constexpr char WIFI_SSID[] = "YOUR_WIFI_SSID";
constexpr char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
constexpr char SERVER_URL[] = "http://YOUR_COMPUTER_LAN_IP:3001/api/device";
constexpr char DEVICE_KEY[] = "MATCH_SMARTCART_DEVICE_KEY";
constexpr char DEVICE_ID[] = "SC-01-ESP32";

// Example pins for a classic ESP32 DevKit with default VSPI.
constexpr int RFID_SS = 5, RFID_RST = 27, RFID_SCK = 18, RFID_MISO = 19, RFID_MOSI = 23;
constexpr int HX_DOUT = 32, HX_SCK = 33, BUZZER = 25, I2C_SDA = 21, I2C_SCL = 22;
constexpr int LCD_ADDRESS = 0x27;
constexpr bool BUZZER_ACTIVE_HIGH = true;
constexpr float INITIAL_COUNTS_PER_GRAM = 1.0f;  // Replace with your measured factor.
constexpr bool INITIAL_FACTOR_CALIBRATED = false;  // Set true only after measuring the factor.
