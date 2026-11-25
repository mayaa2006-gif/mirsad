# الملفات الفنية الداعمة: مرصاد الخصوصية

- `architecture/architecture.png`: مخطط آلية العمل.
- `dataset.js/`: 30 صورة اختبار ببيانات وهمية (img_01..img_30) وملف الإجابات `ground_truth.json`.
- `python_tools/`: النسخة الأصلية من الفحص عبر سطر الأوامر (`scanner.py` للفحص التقني، `ai.py` للتحليل، `evaluate.py` للقياس، `make_dataset.py` لتوليد الصور). المتطلبات في `requirements.txt`.
- `cloudflare_worker/worker.js`: كود الوسيط الذي يحمل مفتاح Gemini (المفتاح نفسه غير موجود هنا).

كل بيانات الاختبار وهمية.
