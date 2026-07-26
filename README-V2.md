# ETH99OS V2 - Gelişmiş Özel Komutlar

Bu sürüm `/komut-ekle` komutuna üç cevap türü ekler:

- `Metin`
- `Embed`
- `Butonlu Embed`

Eski düz metin özel komutları otomatik olarak `Metin` türüne dönüştürülür.

## Kurulum

Mevcut `.env` dosyanızı koruyun. Bu pakette `.env` bulunmaz.

```bash
npm install
npm run check
npm start
```

## Örnekler

### Metin

`/komut-ekle isim:ip tur:Metin cevap:https://discord.gg/...`

### Embed

`/komut-ekle isim:kurallar tur:Embed baslik:📜 Kurallar aciklama:Kurallara uyunuz. renk:mor`

### Butonlu embed

`/komut-ekle isim:instagram tur:Butonlu Embed baslik:📸 Instagram aciklama:Bizi takip edin. renk:mor buton-yazisi:Instagram'a Git buton-linki:https://instagram.com/...`

İsteğe bağlı alanlar: `resim`, `kucuk-resim`, `alt-yazi`.
