# CampaignHub — Step 1: Setup, Register/Login, Volunteer Verification

Frontend: HTML, CSS, JavaScript (`client/`)
Backend: Node.js + Express + MongoDB (`server/`)

## চালানোর নিয়ম

1. VS Code-এ `campaignhub` ফোল্ডারটা খোলো।
2. Terminal খোলো (Ctrl + `) এবং লেখো:
   ```
   cd server
   npm install
   ```
3. `server/.env.example` ফাইলটা কপি করে নাম দাও `.env`, তারপর `MONGO_URI` আর `JWT_SECRET` বসাও।
4. প্রথম Admin অ্যাকাউন্ট বানাও (একবারই লাগবে):
   ```
   npm run seed:admin
   ```
5. সার্ভার চালু করো:
   ```
   npm run dev
   ```
6. ব্রাউজারে যাও: http://localhost:5000

## টেস্ট করার ক্রম

1. Register পেজ থেকে একজন Volunteer অ্যাকাউন্ট খোলো → লগইন করলে "Waiting for verification" দেখাবে।
2. লগআউট করে Admin (`.env`-এর ADMIN_EMAIL / ADMIN_PASSWORD) দিয়ে লগইন করো → Pending তালিকায় Approve চাপো।
3. আবার Volunteer দিয়ে লগইন করো → এখন "Welcome" দেখাবে।
4. Reject করে দেখো → Volunteer কারণসহ "Registration rejected" দেখবে।

## API

| Method | URL | কে ব্যবহার করবে |
|---|---|---|
| POST | /api/auth/register | সবাই |
| POST | /api/auth/login | সবাই |
| GET | /api/auth/me | লগইন করা ইউজার |
| PUT | /api/auth/me | লগইন করা ইউজার (প্রোফাইল আপডেট) |
| GET | /api/admin/volunteers?status=pending | Admin |
| PATCH | /api/admin/volunteers/:id | Admin (body: `{ "decision": "approved" \| "rejected", "reason": "..." }`) |

---

# Step 2 — Campaigns

## Workflow
`Draft → Submitted → Approved / Rejected → Active → Completed`

| কে | কী করতে পারে |
|---|---|
| Manager | Campaign বানানো (draft), Edit/Delete (শুধু draft বা rejected), Submit, Approved হলে **Make active**, Active হলে **Mark as completed** |
| Admin | Submitted campaign **Approve** বা **Reject** (কারণসহ) |
| Volunteer (verified) | শুধু **Active** campaign দেখা, খোঁজা, skill মিলিয়ে সাজানো |

## টেস্ট করার ক্রম
1. Manager দিয়ে লগইন → My Campaigns → **New campaign** → ফর্ম পূরণ → **Save & submit**
2. Admin দিয়ে লগইন → Campaign Approval → একটা **Approve**, আরেকটা **Reject** (কারণ লিখে)
3. Manager → Rejected campaign-এ কারণ দেখাবে, Edit করে Resubmit করা যাবে; Approved campaign-এ **Make active**
4. Verified Volunteer → Browse Campaigns → Active campaign দেখাবে, skill মিললে "Matches your skills" দেখাবে
5. Pending Volunteer → Browse Campaigns লক থাকবে

## নতুন API
| Method | URL | কে |
|---|---|---|
| POST | /api/campaigns | Manager |
| GET | /api/campaigns/mine | Manager |
| PUT | /api/campaigns/:id | Manager (draft/rejected) |
| DELETE | /api/campaigns/:id | Manager (draft/rejected) |
| PATCH | /api/campaigns/:id/submit | Manager |
| PATCH | /api/campaigns/:id/activate | Manager (approved → active) |
| PATCH | /api/campaigns/:id/complete | Manager (active → completed) |
| GET | /api/campaigns/admin?status= | Admin |
| PATCH | /api/campaigns/:id/review | Admin (`{ decision, reason }`) |
| GET | /api/campaigns/active | Verified volunteer |

---

# Step 3 — Volunteer Applications

## Workflow
`Applied → Accepted / Rejected`  (Volunteer can **withdraw** while it is "Applied")

| কে | কী করতে পারে |
|---|---|
| Volunteer (verified) | Active campaign-এ **Apply** (ইচ্ছা হলে একটা message সহ), **My Applications**-এ অবস্থা দেখা, Pending থাকলে **Withdraw** |
| Manager | **Applications** পেজে নিজের campaign-এর সব application দেখা, **Accept** বা **Reject** (ঐচ্ছিক note সহ) |

## নিয়ম (backend-এ চেক হয়)
- শুধু **Active** campaign-এ apply করা যায়
- একই campaign-এ একজন volunteer একবারই apply করতে পারে
- Admin approve না করা volunteer apply করতে পারে না
- Manager শুধু নিজের campaign-এর application দেখতে ও সিদ্ধান্ত নিতে পারে
- "Volunteers needed" পূর্ণ হয়ে গেলে আর Accept করা যায় না
- Accept/Reject হয়ে গেলে আর Withdraw বা আবার সিদ্ধান্ত নেওয়া যায় না

## টেস্ট করার ক্রম
1. Volunteer → Browse Campaigns → **View & apply** → message লিখে **Apply to join**
2. আরেকজন Volunteer দিয়েও apply করো
3. Manager → **Applications** → একজনকে **Accept** (note লিখে), আরেকজনকে **Reject**
4. Volunteer → **My Applications** → Accepted/Rejected আর Manager-এর note দেখাবে
5. Dashboard-এ সংখ্যাগুলো মিলিয়ে দেখো

## নতুন API
| Method | URL | কে |
|---|---|---|
| POST | /api/applications | Volunteer (`{ campaignId, message }`) |
| GET | /api/applications/mine | Volunteer |
| DELETE | /api/applications/:id | Volunteer (শুধু applied) |
| GET | /api/applications/manager | Manager |
| PATCH | /api/applications/:id/decision | Manager (`{ decision, note }`) |

---

# Admin: Remove / Restore / Delete campaign (Req 17)

Admin → **Campaign Approval** → যেকোনো campaign-এ (Waiting approval বাদে) **Remove** বাটন।

| কাজ | কী হয় | ফেরত আনা যায়? |
|---|---|---|
| **Remove** (কারণ লেখা বাধ্যতামূলক) | Volunteer-রা আর দেখতে পায় না, নতুন apply বন্ধ। Manager আর আবেদনকারী volunteer কারণ দেখতে পায় | হ্যাঁ, **Restore** দিয়ে আগের অবস্থায় |
| **Delete permanently** (শুধু Removed campaign-এ) | Campaign আর তার সব application চিরতরে মুছে যায় | না |

| Method | URL | কে |
|---|---|---|
| PATCH | /api/campaigns/:id/remove | Admin (`{ reason }`) |
| PATCH | /api/campaigns/:id/restore | Admin |
| DELETE | /api/campaigns/:id/permanent | Admin (শুধু removed) |

---

# Admin — Remove campaigns & managers (Req 17)

## Campaign
Admin → **Campaign Approval** → যেকোনো campaign (Approved/Active হলেও) → **Remove** (কারণ লিখতে হবে)
- Volunteer-রা আর campaign দেখবে না; Manager আর Volunteer কারণ দেখবে
- **Removed by Admin** ট্যাবে → **Restore** (আগের অবস্থায় ফেরত) বা **Delete permanently** (campaign + সব application চিরতরে মুছে যাবে)

## Manager
Admin → **Managers** (নতুন পেজ) → সব manager, তাদের campaign সংখ্যা ও বাজেট
- **Remove manager**: কারণ + নাম টাইপ করে নিশ্চিত করতে হয়
  - Manager আর লগইন করতে পারবে না, লগইন করলে কারণ দেখাবে
  - তার সব campaign (draft বাদে) একসাথে remove হবে
- **Restore**: অ্যাকাউন্ট আবার চালু হবে, আর যে campaign গুলো তার সাথে remove হয়েছিল সেগুলো আগের অবস্থায় ফিরবে

## নতুন API
| Method | URL | কে |
|---|---|---|
| PATCH | /api/campaigns/:id/remove | Admin (`{ reason }`) |
| PATCH | /api/campaigns/:id/restore | Admin |
| DELETE | /api/campaigns/:id/permanent | Admin (শুধু removed campaign) |
| GET | /api/admin/managers | Admin |
| PATCH | /api/admin/managers/:id/remove | Admin (`{ reason }`) |
| PATCH | /api/admin/managers/:id/restore | Admin |

---

# Step 4 — Tasks, Proof & Smart Allocation

## Workflow
`To do (pending) → In progress → Needs review (submitted) → Verified (completed)`
`Needs review → Revision needed → (resubmit) → Needs review ...`

**শুধু Manager-ই task "Completed" করতে পারে।** Volunteer শুধু proof জমা দিতে পারে (Req 3.4, 10)।

| কে | কী করতে পারে |
|---|---|
| Manager | **Tasks** পেজে campaign বেছে **New task** → Smart suggestions থেকে volunteer বাছাই → Assign; জমা পড়া proof **Review** → ⭐ rating দিয়ে **Mark as completed** অথবা কারণ লিখে **Ask for revision** |
| Volunteer | **My Tasks** → **Start task** → কাজ শেষে **Submit proof** (ছবি/PDF + লিংক + বিবরণ) → Revision চাইলে ঠিক করে **Resubmit** |

## Smart Task Allocation (CEP — Req 9) — `server/services/allocation.js`
```
Score (0–100) = 50% Skill + 20% Availability + 15% Verified completion rate + 15% Rating
```
- **Skill:** task-এর skill থাকলে 100%, না থাকলে campaign-এর skill কতটা মেলে তার অর্ধেক
- **Availability:** deadline-এর আগে volunteer ফ্রি থাকবে কিনা (শুক্র-শনি = weekend) 70% + এখন কয়টা খোলা task আছে 30%
- **Completion rate:** Manager যেগুলো **verify** করেছে শুধু সেগুলো গোনা হয় — ফাঁকি দিয়ে বাড়ানো যায় না
- **Rating:** Manager-এর দেওয়া গড় ⭐ (নতুন volunteer = 50%)
- 200 volunteer / 2000 task ≈ 6 ms এ rank হয় (NFR: 500 ms এর নিচে)

## Proof file নিয়ম (NFR 23) — `server/services/saveFiles.js`
- শুধু JPG, PNG, PDF · সর্বোচ্চ 5টা file · প্রতিটা 5 MB
- ফাইলের ভেতরের প্রথম bytes চেক করা হয় — নাম বদলানো ভুয়া ফাইল আটকায়
- ফাইল জমা হয় `server/uploads/proofs/` ফোল্ডারে (random নাম); কোনো নতুন package লাগেনি
- Deadline পার হয়ে জমা দিলে **Late** চিহ্ন থাকে

## নতুন API
| Method | URL | কে |
|---|---|---|
| GET | /api/tasks/recommend?campaign=&skill=&deadline= | Manager |
| GET | /api/tasks/manager | Manager |
| POST | /api/tasks | Manager |
| PUT / DELETE | /api/tasks/:id | Manager (শুধু শুরু না হওয়া task) |
| PATCH | /api/tasks/:id/review | Manager (`{ decision, feedback, rating }`) |
| GET | /api/tasks/mine | Volunteer |
| PATCH | /api/tasks/:id/start | Volunteer |
| POST | /api/tasks/:id/submit | Volunteer (`{ summary, links, files }`) |

---

# Account — Profile, Show password, Forgot password

## My Profile (`/profile.html`, sidebar → My Profile, অথবা ওপরে নিজের নামে ক্লিক)
- সবাই: নাম, ফোন, লোকেশন বদলানো; **Change password** (পুরোনো পাসওয়ার্ড লাগবে, অন্য ডিভাইস লগআউট হবে)
- Volunteer: **skill তালিকা থেকে বাছাই** + নিজে নতুন skill যোগ, Availability বদলানো → পরের task-এর Smart suggestions-এ সাথে সাথে কাজে লাগে
- Manager: Organization নাম বদলানো
- Register পেজেও এখন একই skill picker (ভুল বানান/ডুপ্লিকেট আর হবে না)

## Show password (👁)
সব পাসওয়ার্ড ঘরের ডান পাশে চোখের আইকন — চাপলে দেখা যায়, আবার চাপলে লুকায়।

## Forgot password
1. Login পেজে **Forgot password?** → ইমেইল দাও → **Send code**
2. ইমেইলে আসা **৬ সংখ্যার কোড** + নতুন পাসওয়ার্ড দাও → **Reset password**

**ইমেইল সেটআপ না করলে (development mode):** কোড ইমেইলে না গিয়ে সার্ভারের terminal-এ (যেখানে `npm run dev` চলছে) দেখায়:
```
==============================================
  PASSWORD RESET CODE (development mode)
  User : Rahat <rahat@gmail.com>
  Code : 482913   (valid for 10 minutes)
==============================================
```
**আসল ইমেইল পাঠাতে:** `npm install nodemailer`, তারপর `.env`-এ `SMTP_*` ঘরগুলো পূরণ করো (`.env.example` দেখো)।

নিরাপত্তা: কোড ১০ মিনিট কাজ করে · একবারই ব্যবহার করা যায় · ৫ বার ভুল দিলে বাতিল · নতুন কোড চাইতে ৬০ সেকেন্ড অপেক্ষা · কোড database-এ hash করে রাখা · রিসেটের পর পুরোনো সব লগইন বাতিল · ইমেইল রেজিস্টার্ড কিনা উত্তর দেখে বোঝা যায় না

## নতুন API
| Method | URL | কে |
|---|---|---|
| PUT | /api/auth/me | লগইন করা ইউজার (প্রোফাইল) |
| PUT | /api/auth/password | লগইন করা ইউজার (`{ currentPassword, newPassword }`) |
| POST | /api/auth/forgot | সবাই (`{ email }`) |
| POST | /api/auth/reset | সবাই (`{ email, code, newPassword }`) |

---

# In-app Notifications (Req 3.5, 4.3)

আলাদা notification inbox না বানিয়ে, database-এ যা আছে (task, application, campaign) তা থেকেই সতর্কবার্তা তৈরি হয় — `server/controllers/alertController.js`। কাজ শেষ হলে সতর্কবার্তা নিজে থেকেই চলে যায়।

| কোথায় | কী দেখায় |
|---|---|
| **Sidebar badge** (লাল সংখ্যা) | Volunteer: My Tasks (করতে হবে), My Applications (৩ দিনে সিদ্ধান্ত) · Manager: Tasks (review বাকি), Applications (নতুন), My Campaigns (approved/rejected) · Admin: Volunteer Verification, Campaign Approval |
| **Dashboard → Action needed** | প্রতিটা ঘটনা আলাদা লাইনে, ক্লিক করলে সরাসরি সেই পেজে |
| **NEW ট্যাগ** | Volunteer শেষবার My Tasks খোলার পর আসা নতুন task |
| **Tab-এর নাম** | `(3) Volunteer Dashboard` — কয়টা জরুরি কাজ বাকি |

**Volunteer যা জানতে পারে:** নতুন task · Revision needed (feedback সহ) · **Due today / Due tomorrow / Overdue** · Verified (⭐ সহ) · Application accepted/rejected · অ্যাকাউন্টের অবস্থা
**Manager:** Proof to review · নতুন application · Campaign approved/rejected/removed · Overdue task
**Admin:** কতজন volunteer আর কতগুলো campaign অপেক্ষায়

পেজ খোলা থাকলে প্রতি ৩০ সেকেন্ডে নিজে থেকে আপডেট হয় (রিফ্রেশ লাগে না)।

**দুই ধরনের সতর্কবার্তা:**
- **কাজ** (New task, Revision needed, Due soon, Proof to review…) — কাজটা শেষ না হওয়া পর্যন্ত থাকে
- **খবর** (Verified, You joined, Not accepted, Campaign removed) — একবার দেখলে সরে যায়:
  My Applications খুললে application-এর খবর, My Tasks খুললে Verified-এর খবর, My Campaigns খুললে removed-এর খবর,
  অথবা Dashboard-এ **Mark updates as read** চাপলে সব খবর। "দেখা হয়েছে" তথ্য database-এ থাকে, তাই অন্য ডিভাইসেও সরে যায়।

| Method | URL | কে |
|---|---|---|
| GET | /api/alerts | লগইন করা যেকোনো ইউজার |
| POST | /api/alerts/seen | লগইন করা ইউজার (`{ page: "applications" \| "tasks" \| "campaigns" \| "all" }`) |

---

# Step 5 — Expenses & Budget Monitoring (CEP — Req 11)

## Manager → **Expenses** পেজ
- campaign বেছে **Add expense**: কীসের জন্য, পরিমাণ, ক্যাটাগরি, তারিখ, দোকান, নোট, **রসিদ** (JPG/PNG/PDF, 5 MB)
- টাকা লেখার সাথে সাথে দেখায় এই খরচের পর বাজেটের কত % হবে
- **Budget utilization** মিটার, **ক্যাটাগরি অনুযায়ী খরচ**, সব খরচের তালিকা (রসিদ না থাকলে হলুদ "No receipt")
- Edit / Delete করা যায় যতক্ষণ campaign Approved বা Active; **Completed হলে খরচ লক** হয়ে যায়

## Admin → **Budget Monitor** পেজ (Req 4.4, 16)
- চাওয়া বাজেট · approve করা বাজেট · আসল খরচ · কতগুলো campaign বাজেট ছাড়িয়েছে
- পুরো প্ল্যাটফর্মের utilization আর ক্যাটাগরি অনুযায়ী খরচ
- প্রতিটা campaign-এর মিটার (বাজেট ছাড়ানোগুলো আগে) → **Expenses** চাপলে সব খরচ আর রসিদ দেখা যায়

## হিসাবের নিয়ম — `server/services/budget.js`
```
Utilization Rate = মোট খরচ ÷ approve করা বাজেট × 100
  < 80%      → On track (সবুজ)
  80 – 100%  → Close to limit (হলুদ)
  > 100%     → Budget Exceeded (লাল) — Manager আর Admin দুজনের Dashboard + sidebar badge
```

## নতুন API
| Method | URL | কে |
|---|---|---|
| GET | /api/expenses/manager | Manager |
| POST | /api/expenses | Manager (`{ campaign, title, amount, category, date, vendor, note, receipt }`) |
| PUT / DELETE | /api/expenses/:id | Manager (campaign Approved/Active থাকলে) |
| GET | /api/expenses/admin | Admin |
| GET | /api/expenses/admin/:campaignId | Admin |

---

# AI Features (Req 18–22) — Google Gemini

AI শুধু **সাজেস্ট করে**। ইউজার দেখে, বদলায়, তারপর Save করলে তবেই সেভ হয়।

| ফিচার | কোথায় | কী করে |
|---|---|---|
| **AI Task Planner** (18) | Manager → Tasks → **✨ Plan with AI** | campaign-এর লক্ষ্য, তারিখ, skill দেখে ৪–৮টা task সাজেস্ট করে → **Review & assign** (ফর্মে বসে যায়) অথবা **Assign selected** (প্রত্যেকটা BEST MATCH volunteer-কে) |
| **AI Receipt Scanner** (19) | Manager → Expenses → Add expense → রসিদ দিয়ে **✨ Scan receipt with AI** | রসিদ পড়ে টাকা, তারিখ, দোকান, ক্যাটাগরি বসিয়ে দেয় (বাংলা রসিদও); যেটা পড়তে পারেনি সেটা **হলুদ** দেখায় |
| **AI Campaign Recommendation** (20) | Volunteer → Dashboard → **Recommended for you** | skill, availability, এলাকা দেখে ৩টা campaign + কেন মানানসই তার এক লাইন |

**AI কাজ না করলে (21):** পরিষ্কার বার্তা দেখায়, হাতে কাজ চালিয়ে যাওয়া যায়। Recommendation তখন "Skill match" দিয়ে দেখায়।
**Log (22):** প্রতিটা AI অনুরোধ `ailogs` collection-এ — কে, কোন ফিচার, কত সময়, সফল কিনা, আর ইউজার **accepted / edited / rejected** করেছে।
**গোপনীয়তা (31, 32):** AI-কে নাম, ফোন, ইমেইল পাঠানো হয় না; API key শুধু সার্ভারে থাকে।

## Gemini API key সেটআপ (ফ্রি)
1. **https://aistudio.google.com/apikey** খোলো → Google অ্যাকাউন্ট দিয়ে লগইন
2. **Create API key** → key কপি করো
3. `server/.env`-এর শেষে লেখো:
   ```
   GEMINI_API_KEY=এখানে_তোমার_key
   GEMINI_MODEL=gemini-3.5-flash-lite
   AI_TIMEOUT_MS=20000
   ```
4. সার্ভার restart: `npm run dev`
- কোনো নতুন package লাগে না (Node.js-এর নিজস্ব fetch ব্যবহার হয়)
- key না দিলে AI বন্ধ থাকে, বাকি সব আগের মতো চলে

## নতুন API
| Method | URL | কে |
|---|---|---|
| GET | /api/ai/status | লগইন করা ইউজার |
| POST | /api/ai/task-plan | Manager (`{ campaign }`) |
| POST | /api/ai/receipt | Manager (`{ image }`) |
| GET | /api/ai/recommendations | Verified volunteer |
| PATCH | /api/ai/logs/:id | নিজের log (`{ outcome }`) |

---

# Completion Report (Req 7, 2.7, 4.5)

Manager আর নিজে থেকে campaign "Completed" করতে পারে না। রিপোর্ট দিতে হয়, Admin যাচাই করে।

```
Active ──(Manager রিপোর্ট পাঠায়)──▶ Completion review ──(Admin Verify)──▶ Completed
   ▲                                        │
   └────────(Admin Send back + কারণ)─────────┘
```

| কে | কোথায় | কী করে |
|---|---|---|
| Manager | My Campaigns → Active campaign → **Completion report** | system-এর হিসাব দেখে (task, volunteer, rating, খরচ) → কী অর্জন হলো, কতজন উপকৃত, সমস্যা/শিক্ষা, ছবি/PDF (১–৫টা) → **Send to Admin** |
| Admin | Campaign Approval → **Completion review** ট্যাব → **Review report** | রিপোর্ট + প্রতিটা task-এর proof দেখে → **Verify & complete** অথবা **Send back** (কারণ লিখতে হয়) |

নিয়ম:
- কোনো task খোলা থাকলে (Pending / In progress / Needs review / Revision) রিপোর্ট পাঠানো যায় না। তালিকা দেখায়।
- হিসাবের সংখ্যাগুলো system নিজে গোনে, Manager বদলাতে পারে না।
- Review চলাকালীন নতুন task বা expense যোগ করা যায় না।
- Send back হলে campaign আবার Active হয়, Manager ঠিক করে আবার পাঠায় (পুরনো ছবি রেখে দেওয়া যায়)।
- Notification: campaign-এর শেষ তারিখ পার হলে Manager-কে মনে করায়; Admin-এর sidebar-এ রিপোর্টের সংখ্যা; Verify/Send back হলে Manager জানতে পারে; Completed হলে volunteer-রা জানতে পারে।
- ছবি সেভ হয় `server/uploads/reports/`-এ।

## নতুন API
| Method | URL | কে |
|---|---|---|
| GET | /api/campaigns/:id/completion | Manager (হিসাব + খোলা task) |
| POST | /api/campaigns/:id/completion | Manager (`{ summary, beneficiariesReached, challenges, photos, keepPhotos }`) |
| GET | /api/campaigns/:id/completion/admin | Admin (রিপোর্ট + সব task-এর proof) |
| PATCH | /api/campaigns/:id/completion/review | Admin (`{ decision: "approve" \| "return", comment }`) |

পুরনো `PATCH /api/campaigns/:id/complete` আর নেই।

---

# Certificate (Req 14)

Admin যখন Completion Report **Verify** করে, তখন system নিজে থেকে certificate বানায়, প্রত্যেক volunteer-এর জন্য যে:
- ওই campaign-এ **accepted** ছিল, **আর**
- অন্তত **১টা task verified (Completed)** করেছে

| কে | কোথায় | কী পায় |
|---|---|---|
| Volunteer | sidebar → **Certificates** | প্রতিটা certificate-এর কার্ড → **Download PDF**, **Verify**, ID কপি |
| Manager | My Campaigns → Completed → **Report & certificates** | কে কে certificate পেল, PDF ডাউনলোড |
| Admin | Campaign Approval → Completed → **Report** | তালিকা + **Issue missing certificates** (এই আপডেটের আগে verify করা campaign-এর জন্য) |
| যে কেউ (login লাগে না) | **/verify.html** (Login পেজে "Verify it here") | Certificate ID দিলে আসল কিনা দেখায় |

- প্রতিটা certificate-এর একটা **ইউনিক ID**, যেমন `CH-2026-7KQ4XM` (0/O, 1/I বাদ, যাতে পড়তে ভুল না হয়)
- PDF-এর নিচে ID আর verify লিংক ছাপা থাকে
- একজন volunteer একটা campaign-এ একটাই certificate পায়
- PDF বানানো হয় কোনো package ছাড়া (`server/services/pdf.js`), PDF-এর built-in font দিয়ে। তাই নাম **ইংরেজি অক্ষরে** হতে হবে, বাংলা অক্ষর "?" হয়ে যাবে
- Verify পেজে শুধু certificate-এ ছাপা তথ্য দেখায়, ইমেইল বা ফোন না

## নতুন API
| Method | URL | কে |
|---|---|---|
| GET | /api/certificates/verify/:code | **Public** (login লাগে না) |
| GET | /api/certificates/mine | Volunteer |
| GET | /api/certificates/campaign/:id | নিজের campaign-এর Manager / Admin |
| POST | /api/certificates/campaign/:id/issue | Admin |
| GET | /api/certificates/:id/pdf | Volunteer নিজে / campaign-এর Manager / Admin |

---

# Reports (Req 4.4, 16, 22) — Admin → **Reports**

| অংশ | কী দেখায় |
|---|---|
| উপরের ৪টা কার্ড | campaign সংখ্যা, verified volunteer, verified task (+ সময়মতো জমার হার), কতজন উপকৃত (+ লক্ষ্যের কত %), certificate সংখ্যা |
| Budget: requested vs approved vs spent | Req 16-এর মূল হিসাব |
| Spending by category / Campaigns by status / by category | বার চার্ট |
| Budget by campaign | প্রতিটা campaign-এর বাজেট, খরচ, কত % ব্যবহার |
| Completed campaign results | Completion report থেকে: কতজন উপকৃত, task, volunteer, rating, certificate |
| Top volunteers | সবচেয়ে বেশি verified task |
| AI usage | প্রতিটা AI ফিচার কতবার ব্যবহার, কতবার সফল, নেওয়া/বদলানো/বাদ দেওয়া, গড় সময় |

- **Export CSV:** সব টেবিল একটা ফাইলে (Excel-এ খোলে, ৳ ঠিকমতো দেখায়)
- **Print / Save as PDF:** ব্রাউজারের Print খোলে → Destination: **Save as PDF**। প্রিন্টে সাদা ব্যাকগ্রাউন্ড, sidebar/বাটন বাদ।

# Audit Log (Req 15, 22) — Admin → **Audit Log**

কে, কখন, কী করেছে, তার রেকর্ড। **শুধু পড়া যায়**: model-এ update/delete বন্ধ করা আছে (`server/models/AuditLog.js`), আর কোনো edit/delete API নেই।

রেকর্ড হয়:
- **Accounts:** register, volunteer approve/reject, manager remove/restore, password change, reset code চাওয়া ও reset করা, **ভুল পাসওয়ার্ডে login চেষ্টা**
- **Campaigns:** draft তৈরি/মোছা, submit, approve/reject, activate, remove/restore, স্থায়ীভাবে মোছা, completion report পাঠানো/verify/ফেরত
- **Applications:** apply, withdraw, accept/reject
- **Tasks:** তৈরি (allocation score সহ), edit, delete, proof জমা (late কিনা), verify (rating), revision
- **Expenses:** add/edit/delete (টাকা, ক্যাটাগরি, রসিদ আছে কিনা)
- **Certificates:** হাতে issue করা
- **AI:** প্রতিটা AI ব্যবহার (`ailogs` থেকে), কত সময়, ফলাফল

ফিল্টার: ক্যাটাগরি, সার্চ (নাম/campaign/বিবরণ), তারিখ (From–To)। **Export CSV** একই ফিল্টারে (সর্বোচ্চ ৫০০০ লাইন)।

> এই আপডেটের **আগের** কাজগুলোর রেকর্ড থাকবে না, এখন থেকে যা হবে সব রেকর্ড হবে। AI-এর রেকর্ড আগের থেকেই আছে।

## নতুন API (Admin)
| Method | URL |
|---|---|
| GET | /api/admin/reports |
| GET | /api/admin/audit?category=&q=&from=&to=&page= |
| GET | /api/admin/audit/export (CSV) |

---

# নিরাপত্তা আপডেট (NFR 25, Req 1.8)

## ফাইল এখন private
আগে proof, রসিদ আর রিপোর্টের ছবির লিংক জানলে login ছাড়াই খোলা যেত। এখন:
- সার্ভার প্রতিটা ফাইলের লিংকে একটা **গোপন সিল** (`?exp=...&sig=...`) যোগ করে, শুধু যে ইউজারের দেখার অনুমতি আছে তার জন্য
- login করলে ব্রাউজারে একটা **HttpOnly cookie** থাকে (JavaScript পড়তে পারে না, শুধু `/uploads` পথে যায়)
- ফাইল খোলে শুধু তখন, যখন **সিল ঠিক + লিংকের মেয়াদ আছে (৪ ঘণ্টা) + একই ইউজার এই ব্রাউজারে login করা**

| অবস্থা | ফলাফল |
|---|---|
| অ্যাপের ভেতরে login করা অবস্থায় | ✅ খোলে |
| লিংক কপি করে Incognito / অন্য ব্রাউজারে | 🔒 Login required |
| অন্য ইউজারের লিংক | 🔒 Not your link |
| Log out করার পর | 🔒 Login required |
| ৪ ঘণ্টা পরে পুরনো লিংক | 🔒 Link expired (পেজ refresh করলেই নতুন লিংক) |
| সিল ছাড়া পুরনো লিংক (`/uploads/...jpg`) | 🔒 Login required |

কোড: `server/services/fileAccess.js`, `server/middleware/auth.js`। আগের সব ফাইল আগের মতোই কাজ করে।

## Login lock
একই ইমেইলে একই কম্পিউটার থেকে ১৫ মিনিটে **৫ বার ভুল পাসওয়ার্ড** দিলে ১৫ মিনিট login বন্ধ। শেষ ২ বার "attempts left" দেখায়। Forgot password দিয়ে reset করলে সাথে সাথে খুলে যায়। Audit Log-এ "Login locked" লেখা থাকে।

> সার্ভার restart করলে lock মুছে যায় (মেমোরিতে রাখা)।

## অন্যান্য
- সব উত্তরে নিরাপত্তা header: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`
- নতুন API: `POST /api/auth/logout` (file cookie মুছে দেয়)

---

# Forgot password: code by real email (Req 1.7)

Code পাঠানোর ৩টা উপায় (এই ক্রমে চেষ্টা করে):
1. **Brevo email API** (সুপারিশ): PC আর Render দুই জায়গাতেই চলে। ফ্রি, দিনে ৩০০ ইমেইল। `.env`-এ `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`
2. **Gmail SMTP** (App Password + `npm install nodemailer`): শুধু PC-তে। Render-এর ফ্রি প্ল্যানে ইমেইলের পোর্ট (25/465/587) বন্ধ
3. কিছু সেট না থাকলে: code terminal-এ দেখায়

ইমেইল সেট করা থাকলে code **শুধু ইমেইলে** যায়, terminal বা Logs-এ কখনো না (নিরাপত্তার জন্য)। পাঠাতে ব্যর্থ হলে সাইট বন্ধ হয় না, শুধু কারণ Logs আর Audit Log-এ লেখা থাকে।
