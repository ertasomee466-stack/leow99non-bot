KURULUM

1) src/index.ts dosyanı bu paketteki src/index.ts ile değiştir.
2) src/communityFeatures.ts dosyasını projendeki src klasörüne koy.
3) Bot rolünü Kayıtsız ve Member rollerinin üstünde tut.
4) Bota şu izinleri ver:
   - Rolleri Yönet
   - Kanalları Yönet
   - Üyeleri Taşı
   - Mesaj Gönder
   - Mesaj Geçmişini Oku
5) Developer Portal > Bot bölümünde Server Members Intent açık olsun.
6) Terminal:
   npm run check
   npm start

BOT OTOMATİK OLUŞTURUR
- Kayıtsız rolü
- Member rolü
- KAYIT kategorisi
- kurallar kanalı
- kayıt-ol kanalı
- hoş-geldin kanalı
- ÖZEL ODALAR kategorisi
- ➕・oda-oluştur ses kanalı

ÖNEMLİ
Bot, Kayıtsız rolüne diğer kanallarda ViewChannel=false izni uygular.
Kullanıcı kuralları kabul edince Member rolü verilir ve Kayıtsız kaldırılır.
DM ayarları kapalı olan kullanıcılara DM gönderilemez; bu Discord kaynaklıdır.
