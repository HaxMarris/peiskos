# Peiskos Lantern

A small lamp for your shelf that lights up when friends are at a fire. It glows while someone is
sitting at the fire and flickers like a flame while they talk, so you know a hangout has started
without opening Peiskos. It's about $10 of parts, and a soldering iron is optional.

What it shows is set in Peiskos, under **Your account › Lanterns**:

- **Light up**: on or off.
- **Lights up for**: *At the fire* (glows while anyone is there), *Talking* (lights only while
  someone talks), or *Both* (glows at the fire, flickers while they talk).
- **Fires**: all your fires, or only the ones you tick, across all your hearths.
- **Brightness**.

A lantern only ever hears "glow or not, flicker or not, how bright". It never gets names, messages
or sound. You sitting at a fire doesn't light your own lantern.

## Parts

| Part | What to look for | About |
| --- | --- | --- |
| ESP32-C3 board | "ESP32-C3 SuperMini" (USB-C, about 18 × 22 mm) | $3 |
| LED ring | "WS2812B 12-bit ring" (12 LEDs, 37 mm or 50 mm across) | $2 |
| Wires | 3 female-to-female jumper wires, or any thin wire if you solder | $1 |
| Shade | A frosted glass jar, a candle holder, a paper lantern or a 3D-printed shade | $2–5 |
| Power | A USB-C cable and any phone charger (or a laptop port) | you likely have one |

Optional: a 330 Ω resistor in the data wire and a 470 µF capacitor across the ring's power pins
make the LEDs more reliable on long wires. Neither is needed for a lamp this small.

Any other ESP32 board works too (a classic "ESP32 DevKit" is built as `esp32` below, with the
data wire on GPIO 13). A 16- or 24-LED ring works if you change `LED_COUNT` in
`firmware/platformio.ini` and build it yourself.

## Wiring

Three wires from the board to the ring:

| Ring pin | Board pin (C3 SuperMini) | Board pin (ESP32 DevKit) |
| --- | --- | --- |
| 5V (or VCC) | 5V | VIN or 5V |
| GND | GND | GND |
| DIN (data in, not DOUT) | GPIO 4 | GPIO 13 |

Rings usually have pads marked on the back; use **DIN**, not DOUT. If the LEDs show random
colours, the data wire is loose or on DOUT.

Put the ring face up at the bottom of the shade, with the board under it or beside it, and the
USB cable out through the back. Frosted or paper shades spread the light into one glow; clear
glass shows the twelve dots.

## Putting the firmware on it

### In the browser (no tools to install)

1. On GitHub, open **Actions › Lantern firmware**, pick the newest green run, and download
   **lantern-firmware**. Unzip it. Use `lantern-esp32c3.bin` for the SuperMini or
   `lantern-esp32.bin` for an ESP32 DevKit.
2. Plug the board into your computer with a USB cable that carries data (some only charge).
3. In Chrome or Edge, open the [ESP flasher](https://espressif.github.io/esptool-js/), click
   **Connect** and pick the board's port.
4. Under Flash Address put `0x0`, choose the .bin file, and click **Program**. It takes about a
   minute.
5. Unplug it and plug it in again.

If the flasher can't connect: hold the board's **BOOT** button, tap **RESET**, let go of BOOT, and
connect again.

### With PlatformIO

```
cd lantern/firmware
pio run -e c3 -t upload        # ESP32-C3 SuperMini
pio run -e esp32 -t upload     # ESP32 DevKit
pio device monitor             # what it's doing, if something's wrong
```

## Setting it up

1. In Peiskos, open **Your account › Lanterns**, name it, and click **Add a lantern**. You get an
   eight-letter setup code. It works once, for 15 minutes.
2. Plug the lantern in. It breathes **blue** when it's waiting to be set up.
3. On your phone, join the Wi-Fi called **Peiskos Lantern**. A setup page opens. (If it doesn't,
   open `192.168.4.1` in the browser.)
4. Tap **Configure WiFi**, pick your home Wi-Fi and type its password. Under **Peiskos server**
   type your server's address as Peiskos shows it (for example `peiskos.app`), and under **Setup
   code** the code. Save.
5. The lantern joins your Wi-Fi, flashes **white**, and shows as online in Peiskos.

Lanterns need 2.4 GHz Wi-Fi; most home routers have it alongside 5 GHz.

## What the colours mean

| It shows | Meaning |
| --- | --- |
| Blue, breathing | Waiting to be set up (join the "Peiskos Lantern" Wi-Fi) |
| Amber dots going round | Connecting to Peiskos |
| White flash | Connected |
| Dark | Connected, and nobody is at the fires it follows |
| Warm glow, breathing slowly | Someone is at one of its fires |
| Flickering flame | Someone there is talking |
| Three quick blinks | You clicked **Blink it** in Peiskos |
| Red, three flashes | The setup code was wrong or ran out, or the server address is wrong. The setup page opens again |
| Dim red, pulsing | It can't reach Peiskos. It keeps trying every few seconds |

## Starting over

Hold the **BOOT** button for 5 seconds (it turns white) to forget the Wi-Fi and its key. It
restarts, waiting to be set up. To give a lantern to someone else, they add it in their own
account and set it up with their code. **Set up again** or **Remove** in Peiskos also makes a
connected lantern forget its key.

## For people hosting their own Peiskos

- The lantern checks your server's certificate. It trusts Let's Encrypt and ZeroSSL, which is what
  Caddy uses, so a Peiskos set up as in the main README works as is.
- On a home network without a certificate, type the address with `http://` and its port, for
  example `http://192.168.1.20:3000`. The key then travels unencrypted on your network.
- It connects to `/lantern` on the server, which the usual Caddy setup already passes to Peiskos.

## How it talks to Peiskos

- Setup: `POST /api/lanterns/pair` with `{ "code": "ABCD-EFGH" }` returns `{ "key": "…" }`. The
  key is kept in the board's flash. The server keeps only a hash of it.
- After that, a WebSocket to `/lantern` with `Authorization: Bearer <key>`. The server sends
  `{ "type": "light", "level": 0–255, "glow": true/false, "flicker": true/false, "people": n }`
  whenever that changes, `{ "type": "blink" }` to find it, and `{ "type": "forget" }` when it's
  removed or set up again.
- Talking comes from the Peiskos apps of the people at the fire: each app says when its own
  person starts and stops talking, and the server passes that on only to lanterns.
