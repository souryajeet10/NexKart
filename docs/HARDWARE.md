# ESP32 hardware setup

For the complete current commissioning and testing workflow, see [HARDWARE_SETUP.md](../HARDWARE_SETUP.md).

## Wiring

This pin map targets a classic ESP32 DevKit. Check the exact board pinout and module labels before connecting power. Set alternative GPIOs in `firmware/SmartCart/config.h`.

| Module | Module pins | ESP32 connection |
|---|---|---|
| RC522 RFID | SCK, MISO, MOSI, SDA/SS, RST | GPIO 18, 19, 23, 5, 27 |
| RC522 RFID | VCC, GND | 3.3 V and common ground |
| HX711 | DOUT, SCK | GPIO 32 and 33, with 3.3 V-compatible digital levels |
| LCD backpack | SDA, SCL | GPIO 21 and 22, through a bidirectional I²C level shifter for a 5 V bus |
| Active buzzer | Driver input | GPIO 25, with a suitable transistor or driver for the buzzer |
| Load cell | E+, E−, A+, A− | HX711 excitation and channel A inputs. Check the cell's wire documentation. |

Use common ground. The ESP32 GPIO uses 3.3 V logic. Use 3.3 V power for a typical RC522 breakout. Check the HX711 board's power scheme and DOUT level. Some breakout boards separate analog supply and digital logic supply. Keep the digital side compatible with 3.3 V even when the module uses a higher analog supply. For a 5 V LCD backpack, check where SDA and SCL are pulled up and keep the 5 V pull-ups on the high side of the level shifter. Use a suitable active buzzer and set its active polarity in the config. A magnetic buzzer may require a flyback diode on its driver. GPIO 5 is a boot strapping pin on classic ESP32 boards. If the reader interferes with startup, use another available pin for RFID SS and update the config.

Mount the 5 kg load cell according to its datasheet and account for platform dead load. The app's 5,000 g limit applies to the net reported load. The physical cell's rating includes all force on the cell, including the platform, and must be respected independently.

References: [Espressif ESP32-WROOM-32 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32_datasheet_en.pdf), [NXP MFRC522 datasheet](https://www.nxp.com/docs/en/data-sheet/MFRC522.pdf), [NXP I²C level-shifting application note](https://www.nxp.com/docs/en/application-note/AN10441.pdf), [bogde HX711 library](https://github.com/bogde/HX711).

## Configure and flash

1. Install the Espressif ESP32 Arduino board package in Arduino IDE. Install ArduinoJson 7, HX711 by bogde, MFRC522 by GithubCommunity, and a LiquidCrystal_I2C library that exposes `LiquidCrystal_I2C(address, columns, rows)`, `init()`, and `backlight()`.
2. Copy `.env.example` to `.env`. Set `HOST=0.0.0.0` and set `SMARTCART_DEVICE_KEY` to a long, unique shared credential. Restart the server. Allow local inbound TCP traffic on port 3001 for the ESP32. Use a trusted private LAN. The example protocol uses HTTP, which sends the bearer credential in cleartext on that network.
3. Find your computer's LAN IPv4 address. Copy `config.example.h` to `config.h` in the sketch folder. Fill in the Wi-Fi details, LAN server URL, and matching device key. Keep both configuration files containing real credentials private.
4. Open `SmartCart.ino` in Arduino IDE. Select the actual board and serial port, then compile and upload. Open the dashboard on the server computer and choose **Hardware Mode** in settings while the cart is empty.
5. Keep the platform empty and select **Tare scale**. The firmware stores the offset. Open Serial Monitor at 115200 baud. With an initially uncalibrated device, the firmware prints net raw counts once tared. Place a known calibration weight, wait for a steady reading, and divide the net counts by the known mass in grams. Preserve the sign of the factor. Remove the known mass and enter the factor in dashboard settings. The firmware stores it in ESP32 preferences. Use the same known mass again to confirm that the dashboard displays the correct grams, then remove it. The temporary unscanned-weight alert should clear when the scale returns to zero.
6. Register the physical tags under **Products**. A scan of an unregistered tag appears as an unknown UID in **Live activity**, which you can copy to the product form. Scan a tag and wait for the pending product to appear before placing it on the scale. Remove the tag from the reader field before scanning another unit with the same tag.

The firmware runs HTTP requests in a separate task. The main loop checks for HX711 data, handles tags, updates the LCD and drives an active buzzer with timed pulses. A missing or uncalibrated sensor does not send fabricated weight readings. The dashboard uses a five-reading stability window.

## Physical acceptance checklist

- Validate the pin map and voltages against the actual boards and confirm the LCD address.
- Check tare and known weights at several points below the cell's rated load.
- Verify RFID UID registration, rejected unknown tags, removal, repeat scans and Wi-Fi reconnect.
- Verify the repeating warning, correction, silence after verification and buzzer polarity.
- Disconnect the HX711 and ESP32 independently and verify checkout blocks.
- After checkout, physically unload the trolley and wait for a stable empty scale before starting a new session.

The Node.js tests exercise the protocol with test requests. Arduino compilation, flash and electrical behavior require the Arduino toolchain and physical assembly.
