# Fares Bot — تشغيل

## 1) قاعدة البيانات (إلزامية)
ضع رابط MongoDB في متغيّر بيئة واحد:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
MONGODB_DB_NAME=fares_bot
MONGO_POOL_SIZE=80
SESSION_STORAGE_MODE=database
WRITE_LOCAL_STATE_CACHE=false
```

كل رقم له جلسة منفصلة محفوظة في القاعدة تحت الاسم:
`wa_session_<userId>_<number>`
وتبقى جميع إعدادات كل رقم (إيموجي التفاعل، البادئة، الوضع، الحمايات...)
محفوظة في نفس القاعدة في وثيقة المستخدم بصورة دائمة.

> لا حاجة لأي مجلد `sessions/` على القرص — كل شيء يُحفظ في القاعدة.

## 2) تشغيل
```
npm install
npm start
```

عند إعادة تشغيل البوت يستعيد تلقائياً جميع الأرقام التي اعتمادها محفوظ في القاعدة
ويتصل بها دون طلب إعادة ربط، وتبقى إعداداتها كما هي.

## 3) التفاعل على الحالات
كل رقم مربوط ويستند إلى جلسة موجودة في القاعدة يبقى متفاعلاً تلقائياً على جميع
أنواع الحالات (نص / صورة / فيديو / صوت) دون استثناء.
