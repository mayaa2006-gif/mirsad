"""ينشئ 30 صورة تجريبية ببيانات وهمية مزروعة + ملف الإجابات الصحيحة."""
import json, os, random
from PIL import Image, ImageDraw, ImageFont

random.seed(7)
os.makedirs("dataset", exist_ok=True)
try:
    font = ImageFont.load_default(size=22)
except TypeError:
    font = ImageFont.load_default()

LINES = {
    "phone_number": lambda: f"Call me on 05{random.randint(10000000, 99999999)}",
    "password": lambda: f"wifi password: Test@{random.randint(1000, 9999)}",
    "email": lambda: f"mail me: user{random.randint(10, 99)}@example.com",
    "ip_address": lambda: f"server IP: 192.168.{random.randint(0, 9)}.{random.randint(10, 99)}",
    "national_id": lambda: f"ID: 1{random.randint(100000000, 999999999)}",
}
SAFE = ["Hi, how are you?", "See you at the meeting", "Thanks, got it", "Sounds good!",
        "Lunch at 1?", "Sent the file already"]

truth = {}
for n in range(1, 31):
    cats = []
    if n > 5:  # أول 5 صور سليمة تمامًا لقياس الإنذارات الكاذبة
        k = random.randint(1, 3)
        cats = random.sample(list(LINES), k)
        if random.random() < 0.5:
            cats.append("gps_location")
    img = Image.new("RGB", (640, 400), "#f2f2f2")
    d = ImageDraw.Draw(img)
    texts = [LINES[c]() for c in cats if c in LINES] + random.sample(SAFE, 3)
    random.shuffle(texts)
    for i, t in enumerate(texts):
        d.rounded_rectangle([20, 20 + i * 55, 620, 62 + i * 55], 12, fill="white")
        d.text((34, 28 + i * 55), t, fill="black", font=font)
    exif = img.getexif()
    exif[0x010F], exif[0x0110] = "FakePhone", "Model X"
    if "gps_location" in cats:
        gps = exif.get_ifd(0x8825)
        gps[1], gps[2] = "N", (24.0 + random.random(), 30.0, 0.0)
        gps[3], gps[4] = "E", (46.0 + random.random(), 40.0, 0.0)
    name = f"img_{n:02d}.jpg"
    img.save(os.path.join("dataset", name), exif=exif)
    truth[name] = cats
json.dump(truth, open("dataset/ground_truth.json", "w"), indent=1)
print("تم إنشاء 30 صورة في مجلد dataset")
