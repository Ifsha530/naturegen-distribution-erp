NATUREGEN DISTRIBUTION ERP — FIREBASE + GITHUB PAGES
====================================================
No Python. Multi-computer / mobile. Central Firebase database.

ARCHITECTURE
- GitHub Pages: frontend hosting
- Firebase Authentication: user login
- Cloud Firestore: live central data
- Firestore Security Rules: role permissions

ROLES
- Admin: full ERP, users, products, inventory, sales, recovery, expenses, reports, settings
- Salesman: own customers, own sales, own recovery; sale automatically deducts stock including free scheme quantity
- Inventory: stock receiving/adjustment, stock movement history, invoices/customers view
- Recovery: invoices, customers, outstanding and payments

STEP 1 — CREATE FIREBASE PROJECT
1. Open Firebase Console: https://console.firebase.google.com/
2. Create project: Naturegen Distribution
3. Add a Web App (</> icon). App name: Naturegen Distribution ERP
4. Firebase will show firebaseConfig. Keep that page open.

STEP 2 — ENABLE EMAIL/PASSWORD LOGIN
Firebase Console -> Authentication -> Get started -> Sign-in method -> Email/Password -> Enable -> Save.

STEP 3 — CREATE FIRESTORE DATABASE
Firebase Console -> Firestore Database -> Create database.
Choose Production mode and a suitable region.

STEP 4 — INSTALL SECURITY RULES
Firestore Database -> Rules.
Open firestore.rules from this repository, copy all text, paste into Rules editor, then Publish.

STEP 5 — CREATE FIRST ADMIN AUTH USER
Authentication -> Users -> Add user.
Use your admin email/password.
Open that user and copy its UID.

STEP 6 — CREATE FIRST ADMIN PROFILE IN FIRESTORE
Firestore Database -> Data -> Start collection.
Collection ID: users
Document ID: paste the exact UID from Authentication.
Add fields:
  fullName       string   Naturegen Admin
  email          string   your admin email
  role           string   admin
  phone          string   (optional)
  routeArea      string   (optional)
  monthlyTarget  number   0
  active         boolean  true
Save.

STEP 7 — CONNECT config.js
Open config.js and replace the PASTE_ values with the exact Firebase web app configuration values.
Example:
window.NATUREGEN_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "naturegen-distribution.firebaseapp.com",
  projectId: "naturegen-distribution",
  storageBucket: "naturegen-distribution.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
Firebase web configuration is intended to be present in browser apps. Never put service-account private keys or server secrets in this repository.

STEP 8 — AUTHORIZED DOMAIN FOR GITHUB PAGES
Authentication -> Settings -> Authorized domains.
Add: ifsha530.github.io
(If Firebase already allows your deployed domain, no change is needed.)

STEP 9 — GITHUB PAGES
GitHub repository -> Settings -> Pages.
Source: Deploy from a branch
Branch: main
Folder: /(root)
Save.
Live URL should be:
https://ifsha530.github.io/naturegen-distribution-erp/

STEP 10 — FIRST LOGIN + INITIAL DATA
Login with the Admin email/password.
Go to Settings.
Click "Initialize Aimacid + Iron Data" once.
It creates:
- Aimacid Syrup 120 ml: MRP 190, sale 65, cost 35, opening stock 10,400, scheme 10+1
- Iron Syrup 120 ml: sale 90, cost 35, opening stock 2,600, scheme 10+1
- Invoice counter
- Company settings
Opening stock and prices can be edited later by Admin.

CREATING STAFF USERS
Admin -> Users & Roles -> Create User Login.
Create Salesman / Inventory / Recovery users with a temporary password.
The employee can use "Forgot password?" to set/change a password through email.
Setting Active = No blocks ERP database access even if the Firebase Auth login still exists.

HOW SALES WORK
- Salesman logs in from phone/PC.
- Adds/selects customer.
- Enters paid quantity.
- 10+1 free quantity calculates automatically.
- Firestore transaction checks current stock and deducts paid + free units atomically.
- Invoice is linked permanently to the salesman.
- Admin sees salesman-wise sales, recovery, outstanding and target achievement live.

BACKUP
Admin -> Reports -> Export JSON Backup.
Download a backup regularly and store it safely.

IMPORTANT SECURITY
- Do NOT upload any Firebase Admin SDK service-account JSON.
- Do NOT upload private/server keys.
- Only the normal Firebase Web App config belongs in config.js.
- Keep firestore.rules published; the frontend alone is not a security boundary.
