

//#include <WiFi.h>
//#include <esp_wifi.h>
//#include <HTTPClient.h>
#include "time.h"
#include <SPI.h>
#include <Adafruit_PN532.h>
#include <Wire.h>
#include <Adafruit_GFX.h>    // Core graphics library
#include <Adafruit_ST7735.h> // Hardware-specific library for ST7735
#include <Adafruit_ST7789.h> // Hardware-specific library for ST7789
#include <Fonts/FreeSerif12pt7b.h>
#include <Fonts/FreeSerif18pt7b.h>
#include <Fonts/FreeSerif9pt7b.h>
#include <Fonts/FreeSerif24pt7b.h>

//const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -25200;
const int   daylightOffset_sec = 0;
//uint8_t mac_address[] = {0x30,0xc6,0xf7,0x05,0x87,0x20};


#define TFT_CS        5
#define TFT_RST        17 // Or set to -1 and connect to Arduino RESET pin
#define TFT_DC         16
#define GRAY          0x2104
Adafruit_ST7789 tft = Adafruit_ST7789(TFT_CS, TFT_DC, TFT_RST);



// Exact kiosk palette, converted from CSS hex to RGB565.
#define KIOSK_CREAM  0xF77C  // #F2EEE3
#define KIOSK_ORANGE 0xF483  // #F7931E
#define KIOSK_GRAY   0x73AF  // #747678
#define KIOSK_CYAN   0x1DD9  // #18B9C8
#define KIOSK_NAVY   0x1127  // #13243C
// PN532 params

#define PN532_SS   (21)
Adafruit_PN532 nfc(PN532_SS);

// Buttons

#define BUT1 36
#define BUT2 39
#define BUT3 34
#define BUT4 35


void setup() {
    delay(500);
  Serial.begin(115200);

  pinMode(BUT1, INPUT);
  pinMode(BUT2, INPUT);
  pinMode(BUT3, INPUT);
  pinMode(BUT4, INPUT);
  //Serial.print("ESP Board MAC Address:  ");
  //Serial.println(WiFi.macAddress());
  //WiFi.setMACAddress(mac_address);
  //esp_wifi_set_mac(ESP_IF_WIFI_STA, &mac_address[0]);
  //esp_base_mac_addr_set(mac_address);
  //Serial.print("New ESP Board MAC Address:  ");
  //Serial.println(WiFi.macAddress());
  nfc.begin();
  //WiFi.setAutoReconnect(true);
  //WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  //Serial.print("Connecting to Wi-Fi");
  //while (WiFi.status() != WL_CONNECTED)
  //{
  //    Serial.print(".");
  //    delay(300);
 // }
  //Serial.println();
  //Serial.print("Connected with IP: ");
  //Serial.println(WiFi.localIP());
  //Serial.println();
  //configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  // put your setup code here, to run once:
  
  tft.init(240, 320);
  tft.setRotation(3);
  homeScreen();

  
  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (! versiondata) {
    Serial.print("Didn't find PN53x board");
    while (1); // halt
  }
  // Got ok data, print it out!
  Serial.print("Found chip PN5"); Serial.println((versiondata>>24) & 0xFF, HEX); 
  Serial.print("Firmware ver. "); Serial.print((versiondata>>16) & 0xFF, DEC); 
  Serial.print('.'); Serial.println((versiondata>>8) & 0xFF, DEC);
  
  // configure board to read RFID tags
  nfc.SAMConfig();
}

////////////////////////////////////////////////////////
//////////////////////   DISPLAY   /////////////////////
////////////////////////////////////////////////////////

void drawDownArrow(int cx, int top, int width, int height, uint16_t color) {
  int shaftWidth = width / 3;
  int shoulder = top + height / 2;
  tft.fillRect(cx - shaftWidth / 2, top, shaftWidth, height / 2 + 1, color);
  tft.fillTriangle(cx - width / 2, shoulder, cx + width / 2, shoulder,
                   cx, top + height, color);
}

void drawUpArrow(int cx, int top, int width, int height, uint16_t color) {
  int shaftWidth = width / 3;
  int shoulder = top + height / 2;
  tft.fillTriangle(cx, top, cx - width / 2, shoulder,
                   cx + width / 2, shoulder, color);
  tft.fillRect(cx - shaftWidth / 2, shoulder, shaftWidth, height / 2 + 1, color);
}

void homeScreen() {
  tft.setFont(NULL);
  tft.fillScreen(KIOSK_NAVY);
  tft.setTextWrap(false);
  tft.setTextColor(KIOSK_CREAM);
  tft.setTextSize(4);
  tft.setCursor(18, 18);
  tft.print("TAP ID");
  drawDownArrow(160, 72, 124, 104, KIOSK_ORANGE);
  tft.setTextSize(2);
  tft.setCursor(82, 214);
  tft.print("ON BLUE HAND");
}

void animateToLookUp() {
  // Only redraw the text and arrow regions; the background never flashes.
  tft.fillRect(0, 8, 320, 48, KIOSK_NAVY);
  tft.fillRect(0, 205, 320, 35, KIOSK_NAVY);

  for (int frame = 0; frame < 5; frame++) {
    int height = 104 - (frame * 23);
    int width = 124 - (frame * 5);
    tft.fillRect(85, 66, 150, 122, KIOSK_NAVY);
    if (height > 12) {
      drawDownArrow(160, 72 + (104 - height) / 2, width, height, KIOSK_ORANGE);
    } else {
      tft.fillRect(108, 126, 104, 10, KIOSK_ORANGE);
    }
    delay(45);
  }

  for (int frame = 1; frame <= 5; frame++) {
    int height = 10 + (frame * 19);
    int width = 104 + (frame * 4);
    tft.fillRect(85, 66, 150, 122, KIOSK_NAVY);
    drawUpArrow(160, 126 - height / 2, width, height, KIOSK_CREAM);
    delay(45);
  }

  // Static hold: professional, attention-directing, and flicker-free.
  tft.fillScreen(KIOSK_NAVY);
  tft.fillTriangle(0, 0, 112, 0, 86, 34, KIOSK_ORANGE);
  tft.setFont(NULL);
  tft.setTextWrap(false);
  tft.setTextColor(KIOSK_CREAM);
  tft.setTextSize(2);
  tft.setCursor(15, 9);
  tft.print("NEXT");
  drawUpArrow(160, 42, 112, 94, KIOSK_CREAM);
  tft.setTextColor(KIOSK_CREAM);
  tft.setTextSize(4);
  tft.setCursor(76, 146);
  tft.print("LOOK UP");
  tft.fillRect(105, 188, 110, 4, KIOSK_ORANGE);
  tft.setTextColor(KIOSK_ORANGE);
  tft.setTextSize(2);
  tft.setCursor(70, 211);
  tft.print("FINISH CHECK-IN");
}


int logEvent(String user, String uuid, String eventType, String auth, String flags, String Notes){
  return 0;
}

void loop() {
  struct tm timeinfo;
  time_t nowSecs;
  uint32_t versiondata;
  uint8_t success;
  uint8_t uid[] = { 0, 0, 0, 0, 0, 0, 0, 0 };  // Buffer to store the returned UID
  uint8_t uidLength;    
  uint64_t idnum=0;
  //String uidStr;
  char uidStr[30]="";

  // Length of the UID (4 or 7 bytes depending on ISO14443A card type)
  success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength,100);

  if (success) {
    uint32_t szPos;

    for (szPos = 0; szPos < uidLength; szPos++) 
      {sprintf(uidStr,"%s%02X",uidStr,uid[szPos] & 0xff);}    
    nowSecs = time(nullptr);
    //gmtime_r(&nowSecs, &timeinfo);
    Serial.println(String(uidStr));
   
    // The reader confirms only the scan; the kiosk confirms check-in.
    animateToLookUp();
    delay(5000);
    do {
       versiondata = nfc.getFirmwareVersion();
      nfc.SAMConfig();
      nfc.reset();
      nfc.begin();
      //       Serial.print("Found chip PN5"); Serial.println((versiondata>>24) & 0xFF, HEX); 
      // Serial.print("Firmware ver. "); Serial.print((versiondata>>16) & 0xFF, DEC); 
      // Serial.print('.'); Serial.println((versiondata>>8) & 0xFF, DEC);
      delay(50);
    }while(!versiondata);
    homeScreen();
  }
  // Serial.println("\n");
  delay(10);
}