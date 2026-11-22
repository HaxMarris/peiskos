// Peiskos Lantern: a lamp that glows while friends are at a fire and flickers while they talk.
//
// First start (or after a reset) it opens a Wi-Fi network called "Peiskos Lantern". Joining it
// shows a setup page for your home Wi-Fi, your Peiskos server and the setup code from
// Account > Lanterns. The lantern trades that code for a key of its own, keeps it, and from then
// on holds a WebSocket open to the server, which says only how it should look.
//
// Colours: blue breathing = waiting to be set up, amber dots going round = connecting,
// red pulse = can't reach the server (it keeps trying), white flash = connected.
// Hold the button for 5 seconds to forget Wi-Fi and the key and start over.

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <time.h>

#include "roots.h"

#ifndef LED_PIN
#define LED_PIN 4
#endif
#ifndef LED_COUNT
#define LED_COUNT 12
#endif
#ifndef BUTTON_PIN
#define BUTTON_PIN 9
#endif

static const char *AP_NAME = "Peiskos Lantern";
// Twelve LEDs at full white draw about 0.7 A; this keeps the brightest flicker well inside what a
// phone charger or laptop port gives.
static const uint8_t MAX_BRIGHTNESS = 200;

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
Preferences prefs;
WiFiManager wm;
WebSocketsClient ws;

char serverText[80] = "";
char codeText[16] = "";
WiFiManagerParameter serverParam("server", "Peiskos server (for example peiskos.app)", serverText, sizeof(serverText) - 1);
WiFiManagerParameter codeParam("code", "Setup code", codeText, sizeof(codeText) - 1);

enum class Mode { Setup, Connecting, Live, Trouble };
Mode mode = Mode::Setup;

// What the server last asked for.
struct Light {
  uint8_t level = 0;
  bool glow = false;
  bool flicker = false;
} light;

String key;          // this lantern's own key, from pairing
String server;       // as typed: "peiskos.app", "https://chat.example.com" or "http://192.168.1.20:3000"
bool saved = false;  // the setup page was just saved
bool forgetNow = false;  // the server said to forget the key (handled in loop, not inside its callback)
unsigned long flashUntil = 0;   // white "hello" flash
unsigned long blinkUntil = 0;   // "find me" blinks
unsigned long troubleSince = 0;
unsigned long buttonDownAt = 0;

struct Address {
  bool tls = true;
  String host;
  uint16_t port = 443;
};

Address parseServer(String s) {
  Address a;
  s.trim();
  String lower = s;
  lower.toLowerCase();
  if (lower.startsWith("http://")) {
    a.tls = false;
    a.port = 80;
    s = s.substring(7);
  } else if (lower.startsWith("https://")) {
    s = s.substring(8);
  }
  int slash = s.indexOf('/');
  if (slash >= 0) s = s.substring(0, slash);
  int colon = s.indexOf(':');
  if (colon >= 0) {
    a.port = s.substring(colon + 1).toInt();
    s = s.substring(0, colon);
  }
  a.host = s;
  return a;
}

// ---- light ------------------------------------------------------------------

float shown = 0;                       // eased overall level, 0..1
float flame[LED_COUNT];                // each LED's own flicker, 0..1
float flameTarget[LED_COUNT];
unsigned long nextFlame = 0;

void fill(uint8_t r, uint8_t g, uint8_t b, float level) {
  for (int i = 0; i < LED_COUNT; i++) strip.setPixelColor(i, strip.Color(r * level, g * level, b * level));
}

void draw() {
  unsigned long now = millis();
  float t = now / 1000.0f;

  if (now < flashUntil) {
    fill(255, 240, 220, 0.6f);
  } else if (now < blinkUntil) {
    fill(255, 200, 120, ((blinkUntil - now) / 250) % 2 ? 0.9f : 0.0f);
  } else if (mode == Mode::Setup) {
    fill(40, 90, 255, 0.08f + 0.22f * (0.5f + 0.5f * sinf(t * 2.2f)));
  } else if (mode == Mode::Connecting) {
    strip.clear();
    int head = (now / 90) % LED_COUNT;
    for (int k = 0; k < 3; k++) strip.setPixelColor((head + LED_COUNT - k) % LED_COUNT, strip.Color(120 >> k, 60 >> k, 6 >> k));
  } else if (mode == Mode::Trouble) {
    fill(255, 20, 10, 0.04f + 0.12f * (0.5f + 0.5f * sinf(t * 1.5f)));
  } else {
    // Live: ease toward what the server asked for, so it fades in and out like a lamp, not a switch.
    float target = (light.glow || light.flicker) ? light.level / 255.0f : 0.0f;
    shown += (target - shown) * (target > shown ? 0.06f : 0.03f);
    if (light.flicker) {
      // A flame: each LED wanders to a new brightness every 40-120 ms, smoothed.
      if (now >= nextFlame) {
        for (int i = 0; i < LED_COUNT; i++) flameTarget[i] = 0.45f + random(0, 56) / 100.0f;
        nextFlame = now + random(40, 120);
      }
      for (int i = 0; i < LED_COUNT; i++) {
        flame[i] += (flameTarget[i] - flame[i]) * 0.35f;
        float v = shown * flame[i];
        // Dimmer flickers lean red, brighter ones toward yellow.
        strip.setPixelColor(i, strip.Color(255 * v, (70 + 90 * flame[i]) * v, (8 + 20 * flame[i]) * v));
      }
    } else {
      // A slow breath, so a glowing lantern looks alive rather than like a status LED.
      float breath = 0.9f + 0.1f * sinf(t * 1.4f);
      for (int i = 0; i < LED_COUNT; i++) flame[i] = 1.0f;
      fill(255, 138, 40, shown * breath);
    }
  }
  strip.show();
}

// ---- talking to Peiskos -----------------------------------------------------

void forget() {
  prefs.remove("key");
  key = "";
  ws.disconnect();
  mode = Mode::Setup;
  wm.startConfigPortal(AP_NAME);
}

void onSocket(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      mode = Mode::Live;
      troubleSince = 0;
      break;
    case WStype_DISCONNECTED:
      if (mode == Mode::Live) mode = Mode::Connecting;
      if (!troubleSince) troubleSince = millis();
      break;
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) return;
      const char *kind = doc["type"] | "";
      if (!strcmp(kind, "light")) {
        light.level = doc["level"] | 0;
        light.glow = doc["glow"] | false;
        light.flicker = doc["flicker"] | false;
      } else if (!strcmp(kind, "hello")) {
        flashUntil = millis() + 700;
      } else if (!strcmp(kind, "blink")) {
        blinkUntil = millis() + 1500;
      } else if (!strcmp(kind, "forget")) {
        // Removed in Peiskos, or set up again with a new code: wait to be set up.
        forgetNow = true;
      }
      break;
    }
    default:
      break;
  }
}

// TLS checks a certificate's dates, so the clock has to be right first.
void setClock() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  for (int i = 0; i < 40 && time(nullptr) < 1700000000; i++) delay(250);
}

void connectSocket() {
  Address a = parseServer(server);
  static String auth;
  auth = "Authorization: Bearer " + key;
  ws.setExtraHeaders(auth.c_str());
  if (a.tls) ws.beginSslWithCA(a.host.c_str(), a.port, "/lantern", ROOT_CAS);
  else ws.begin(a.host.c_str(), a.port, "/lantern");
  ws.onEvent(onSocket);
  ws.setReconnectInterval(5000);
  // The server pings every 30 s; this notices a dead connection from our side too.
  ws.enableHeartbeat(25000, 8000, 2);
  mode = Mode::Connecting;
  troubleSince = millis();
}

// Trades the setup code for a key. Returns an empty string (and says why on serial) if it can't.
String pair(const String &code) {
  Address a = parseServer(server);
  String url = String(a.tls ? "https://" : "http://") + a.host + ":" + a.port + "/api/lanterns/pair";
  WiFiClientSecure secure;
  WiFiClient plain;
  HTTPClient http;
  if (a.tls) {
    secure.setCACert(ROOT_CAS);
    http.begin(secure, url);
  } else {
    http.begin(plain, url);
  }
  http.addHeader("content-type", "application/json");
  JsonDocument body;
  body["code"] = code;
  String out;
  serializeJson(body, out);
  int status = http.POST(out);
  String reply = http.getString();
  http.end();
  JsonDocument doc;
  if (status != 200 || deserializeJson(doc, reply)) {
    Serial.printf("Pairing failed (%d): %s\n", status, reply.c_str());
    return "";
  }
  return String((const char *)(doc["key"] | ""));
}

void onSaved() { saved = true; }

void startPortal() {
  mode = Mode::Setup;
  wm.startConfigPortal(AP_NAME);
}

// After the setup page is saved and Wi-Fi works: pair if there's a new code, then connect.
void afterSetup() {
  String typed = serverParam.getValue();
  typed.trim();
  if (typed.length()) {
    server = typed;
    prefs.putString("server", server);
  }
  String code = codeParam.getValue();
  code.trim();
  if (code.length()) {
    setClock();
    String got = pair(code);
    if (!got.length()) {
      // Wrong or old code, or the server address is off: show red, then ask again.
      for (int i = 0; i < 3; i++) {
        fill(255, 20, 10, 0.5f);
        strip.show();
        delay(250);
        strip.clear();
        strip.show();
        delay(250);
      }
      return startPortal();
    }
    key = got;
    prefs.putString("key", key);
  }
  if (!key.length() || !server.length()) return startPortal();
  setClock();
  connectSocket();
}

void factoryReset() {
  fill(255, 255, 255, 0.3f);
  strip.show();
  prefs.clear();
  wm.resetSettings();
  delay(800);
  ESP.restart();
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  strip.begin();
  strip.setBrightness(MAX_BRIGHTNESS);
  strip.clear();
  strip.show();
  randomSeed(esp_random());

  prefs.begin("lantern", false);
  key = prefs.getString("key", "");
  server = prefs.getString("server", "");
  strncpy(serverText, server.c_str(), sizeof(serverText) - 1);
  serverParam.setValue(serverText, sizeof(serverText) - 1);

  wm.setTitle("Peiskos Lantern");
  wm.addParameter(&serverParam);
  wm.addParameter(&codeParam);
  wm.setSaveConfigCallback(onSaved);
  wm.setSaveParamsCallback(onSaved);
  wm.setConfigPortalBlocking(false);
  wm.setConfigPortalTimeout(0);
  wm.setConnectTimeout(20);

  if (!key.length()) {
    // Not set up: the setup page, even if Wi-Fi is already known.
    WiFi.mode(WIFI_STA);
    startPortal();
  } else if (wm.autoConnect(AP_NAME)) {
    setClock();
    connectSocket();
  } else {
    // Wi-Fi changed or is down: the setup page opens, and keeps trying the old network meanwhile.
    mode = Mode::Setup;
  }
}

void loop() {
  bool joined = wm.process();  // true once Wi-Fi typed into the setup page works
  if (forgetNow) {
    forgetNow = false;
    forget();
  }
  if ((saved || joined) && WiFi.status() == WL_CONNECTED) {
    saved = false;
    wm.stopConfigPortal();
    afterSetup();
  }
  if (mode == Mode::Setup && key.length() && WiFi.status() == WL_CONNECTED && !wm.getConfigPortalActive()) {
    // The old Wi-Fi came back by itself.
    setClock();
    connectSocket();
  }
  if (mode == Mode::Connecting || mode == Mode::Live || mode == Mode::Trouble) {
    ws.loop();
    if (mode != Mode::Live && troubleSince && millis() - troubleSince > 30000) mode = Mode::Trouble;
  }

  // Held down for 5 s: start over.
  if (digitalRead(BUTTON_PIN) == LOW) {
    if (!buttonDownAt) buttonDownAt = millis();
    else if (millis() - buttonDownAt > 5000) factoryReset();
  } else {
    buttonDownAt = 0;
  }

  static unsigned long lastFrame = 0;
  if (millis() - lastFrame >= 16) {
    lastFrame = millis();
    draw();
  }
}
