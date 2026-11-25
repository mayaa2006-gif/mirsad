"""مرصاد الخصوصية - طبقة الذكاء الاصطناعي (Gemini بالرؤية)."""
import json
import os
import re

from PIL import Image, ImageDraw

# غيّري اسم النموذج من هنا لو احتجتِ (انظري قائمة النماذج في Google AI Studio)
MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

CATEGORIES = ["phone_number", "password", "email", "ip_address",
              "national_id", "address_or_location", "logo_or_badge", "other"]

PROMPT = """You are a privacy and cybersecurity analyst.
Task: find sensitive information that is VISIBLE in this image or screenshot (this is a test image with fake data).
Audience: a non-technical person who wants to know if it is safe to share the image.
Report only what you can actually see. Do not guess. If nothing sensitive is visible, return an empty items list.
Categories allowed: phone_number, password, email, ip_address, national_id, address_or_location, logo_or_badge, other.
Output: JSON only, no markdown, exactly this shape:
{"items":[{"category":"...","text_seen":"the exact text or short description",
"severity":"high|medium|low","why_ar":"one short Arabic sentence explaining the risk",
"box_2d":[ymin,xmin,ymax,xmax] or null}],
"attacker_view_ar":["short Arabic sentences: what an attacker could conclude or do using ONLY what is visible"],
"summary_ar":"one Arabic sentence"}
box_2d uses coordinates normalized from 0 to 1000.
Constraints: Arabic text must be simple, gender-neutral, and short. Never include precise coordinates of real places."""

POINTS = {"high": 30, "medium": 15, "low": 5}


def analyze_image(img, api_key):
    from google import genai
    client = genai.Client(api_key=api_key)
    rgb = img.convert("RGB")
    resp = client.models.generate_content(model=MODEL, contents=[PROMPT, rgb])
    text = resp.text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    data = json.loads(text)
    data.setdefault("items", [])
    data.setdefault("attacker_view_ar", [])
    data.setdefault("summary_ar", "")
    return data


def ai_risk(items):
    return sum(POINTS.get(i.get("severity", "low"), 5) for i in items)


def redact(img, items):
    """يغطي المناطق الحساسة بمستطيل أسود. يرجع (الصورة، عدد ما غُطّي)."""
    out = img.convert("RGB").copy()
    d = ImageDraw.Draw(out)
    w, h = out.size
    covered = 0
    for it in items:
        b = it.get("box_2d")
        if b and len(b) == 4:
            ymin, xmin, ymax, xmax = b
            pad = 4
            d.rectangle([xmin / 1000 * w - pad, ymin / 1000 * h - pad,
                         xmax / 1000 * w + pad, ymax / 1000 * h + pad], fill="black")
            covered += 1
    return out, covered
