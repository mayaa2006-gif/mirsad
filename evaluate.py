"""يقيس دقة الكشف: الفحص التقني وحده مقابل التقني مع الذكاء الاصطناعي.
التشغيل:  python evaluate.py   (يحتاج GEMINI_API_KEY في متغير البيئة)"""
import csv, json, os, time
from PIL import Image
import ai
from scanner import read_metadata

key = os.environ.get("GEMINI_API_KEY")
if not key:
    raise SystemExit("ضعي المفتاح أولًا:  set GEMINI_API_KEY=مفتاحك")

truth = json.load(open("dataset/ground_truth.json"))
rows, T = [], {"tech": [0, 0, 0], "both": [0, 0, 0]}  # TP, FP, FN
for name, real in truth.items():
    path = os.path.join("dataset", name)
    real = set(real)
    tech = {f["cat"] for f in read_metadata(path) if f["cat"] == "gps_location"}
    found_ai = set()
    for attempt in range(3):
        try:
            data = ai.analyze_image(Image.open(path), key)
            found_ai = {i["category"] for i in data["items"]} & set(ai.CATEGORIES)
            break
        except Exception as e:
            print("إعادة محاولة", name, e)
            time.sleep(5)
    both = tech | found_ai
    for label, found in (("tech", tech), ("both", both)):
        T[label][0] += len(real & found)
        T[label][1] += len(found - real)
        T[label][2] += len(real - found)
    rows.append([name, sorted(real), sorted(tech), sorted(both)])
    print(name, "حقيقي:", sorted(real), "| مكتشف:", sorted(both))
    time.sleep(2)

for label, title in (("tech", "الفحص التقني وحده"), ("both", "التقني + الذكاء الاصطناعي")):
    tp, fp, fn = T[label]
    rec = tp / (tp + fn) if tp + fn else 0
    pre = tp / (tp + fp) if tp + fp else 0
    print(f"\n{title}: نسبة الكشف {rec:.0%} | الدقة {pre:.0%} | إنذارات كاذبة {fp}")
with open("results.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f); w.writerow(["image", "real", "tech_only", "tech_plus_ai"]); w.writerows(rows)
print("\nحُفظت النتائج في results.csv")
