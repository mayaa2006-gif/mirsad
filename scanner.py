"""مرصاد الخصوصية - الطبقة التقنية: قراءة البيانات المخفية (EXIF) وتنظيفها."""
from PIL import Image, ExifTags

GPS_TAG = 0x8825


def _to_degrees(value, ref):
    d, m, s = (float(x) for x in value)
    deg = d + m / 60 + s / 3600
    return -deg if ref in ("S", "W") else deg


def read_metadata(src):
    """src: مسار ملف أو ملف مرفوع. يرجع قائمة بالبيانات المخفية."""
    findings = []
    img = Image.open(src)
    exif = img.getexif()

    gps = exif.get_ifd(GPS_TAG)
    if gps and 2 in gps and 4 in gps:
        lat = _to_degrees(gps[2], gps.get(1, "N"))
        lon = _to_degrees(gps[4], gps.get(3, "E"))
        findings.append({"cat": "gps_location", "type": "الموقع الجغرافي",
                         "detail": f"{lat:.2f}, {lon:.2f}", "risk": 50,
                         "why": "يكشف مكان التقاط الصورة، وقد يدل على السكن أو العمل."})

    names = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
    if "Make" in names or "Model" in names:
        findings.append({"cat": "device", "type": "نوع الجهاز",
                         "detail": f"{names.get('Make', '')} {names.get('Model', '')}".strip(),
                         "risk": 10, "why": "يساعد المهاجم على تخمين نوع الجهاز وثغراته."})
    if "DateTime" in names:
        findings.append({"cat": "datetime", "type": "تاريخ ووقت التصوير",
                         "detail": str(names["DateTime"]), "risk": 10,
                         "why": "يكشف أوقات وجود صاحب الصورة في المكان."})
    if "Software" in names:
        findings.append({"cat": "software", "type": "البرنامج المستخدم",
                         "detail": str(names["Software"]), "risk": 5,
                         "why": "معلومة تقنية إضافية عن الجهاز."})
    return findings


def risk_level(score):
    if score >= 85:
        return "آمن"
    if score >= 50:
        return "يحتاج انتباهًا"
    return "لا يُنصح بنشرها"


def clean_pixels(img):
    """نسخة من البكسلات فقط، بدون أي بيانات مخفية."""
    img = img.convert("RGB")
    return Image.frombytes("RGB", img.size, img.tobytes())
