NATUREGEN DISTRIBUTION ERP — ONLINE MULTI-USER SETUP
====================================================

This is a no-Python browser application. It uses Supabase for login, PostgreSQL database, Row Level Security and live multi-user data.

1) CREATE SUPABASE PROJECT
- Go to https://supabase.com and create a project.
- Open SQL Editor.
- Paste the complete contents of schema.sql and Run once.

2) CREATE ADMIN LOGIN
- Supabase Dashboard → Authentication → Users → Add user.
- Create your admin email/password.
- SQL Editor: run this, replacing the email:
  update public.profiles set role='admin', full_name='Naturegen Admin'
  where id=(select id from auth.users where email='YOUR_ADMIN_EMAIL');

3) CONNECT THE WEBSITE
- Supabase Dashboard → Project Settings → API.
- Copy Project URL and Publishable/anon key.
- Open config.js and paste both values.
- NEVER paste a service_role/secret key into config.js.

4) HOST IT ONLINE
Any static host works because the database is Supabase:
- Netlify Drop (simple)
- Cloudflare Pages
- GitHub Pages
- Your own WordPress hosting subfolder/domain
Upload: index.html, styles.css, app.js, config.js.

5) CREATE STAFF USERS
- Create each user in Supabase Dashboard → Authentication → Users.
- New users are automatically created as role = salesman.
- Login as Admin in Naturegen ERP → Users & Roles and change role to Inventory / Recovery / Salesman as needed.
- Add route/area and monthly target.

ROLE ACCESS
Admin: full dashboard, products, inventory, all sales, recoveries, expenses, reports, users, settings.
Inventory: products/stock and stock movements; can add/adjust stock through controlled stock function.
Salesman: create customers assigned to self, enter own sales, see own invoices/performance, record recovery only against own invoices.
Recovery: view all invoices/outstanding and record payments.

IMPORTANT BUSINESS LOGIC
- 10+1 scheme is calculated automatically from each product's scheme settings.
- Sale transaction locks stock rows, checks availability, creates invoice/items and deducts paid + free quantities atomically.
- Two users selling at the same time cannot legitimately drive stock below zero through the sale function.
- All devices use the same cloud database.
- Realtime subscriptions refresh live dashboard/inventory when products, sales, customers or payments change.

INITIAL DATA INCLUDED
Aimacid Syrup 120 ml: MRP 190, sale 65, cost 35, opening stock 10,400, scheme 10+1.
Iron Syrup 120 ml: sale 90, cost 35, opening stock 2,600, scheme 10+1.
All values can be changed by Admin.

SECURITY
- Row Level Security (RLS) is enabled.
- The browser uses only a publishable/anon key.
- Keep service_role/secret keys out of the browser files.
- For production, disable public signup in Supabase Auth and create staff users only from the admin dashboard in Supabase.

FILES
index.html      Main app shell
styles.css      Responsive desktop/mobile UI
app.js          App logic
config.js       Supabase connection values
schema.sql      Database + RLS + transaction functions
README_SETUP.txt This setup guide
