# Buladde Palm Villa Hotel Platform
A mobile-friendly hotel management platform built with Next.js 14 App Router, Supabase PostgreSQL/Auth, Tailwind CSS and Vercel.
## Current implementation
- Next.js 14 App Router foundation and green/gold branding.
- Supabase email/password authentication and protected owner, manager and staff areas.
- Owner overview, staff directory/invitations, booking approval and room assignment, finance view, audit log and integration settings.
- Department-scoped manager overview, front desk booking approval, staff task/attendance/issue-report workspace.
- Public home, live room catalogue, restaurant menu, booking request, contact form and gallery placeholder.
- PostgreSQL schema with Row Level Security, role hardening and audit triggers.
- Resend notifications for booking requests, reception enquiries and staff invitations.
- Pesapal API 3.0 checkout initiation, IPN registration and server-side transaction-status verification.
## Setup
1. Use Node.js 20+. Copy `.env.example` to `.env.local`.
2. Create a Supabase project and set project URL, anon key and service role key. Service role is server-only.
3. Apply migrations in order from `supabase/migrations`.
4. Create the owner in Supabase Authentication, then insert a matching `public.profiles` row with the same Auth UUID and role `owner`.
5. Set Supabase Auth Site URL to your domain and add local and production callback URLs. Account invitations return through `/auth/callback`.
6. Verify your sending domain in Resend. Configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `RECEPTION_EMAIL`.
7. Run `npm install` and `npm run dev`.
## Adding staff and managers
Sign in as owner, open **Staff & teams**, and invite the person with their name, email, phone, role and department. Resend sends a secure invitation/confirmation link. The invited user creates their own password. Finance is reserved for the owner.
## Adding rooms and menu items
Insert rooms into `public.rooms` with unique room number, room type, nightly rate in UGX, facilities array and image URLs. Insert menu items into `public.restaurant_menu_items`. Upload real hotel photographs to Supabase Storage.
## Booking approval
The public form creates pending requests. Owner or the Front Desk manager can assign a room and confirm. The database function checks date overlaps before confirmation. The room is marked booked after confirmation. Housekeeping room turnover and check-out workflow are a follow-up phase.
## Pesapal setup
1. Start with Pesapal sandbox credentials and set `PESAPAL_ENVIRONMENT=sandbox`.
2. Deploy to an HTTPS Vercel preview or production domain and set `NEXT_PUBLIC_SITE_URL` to that domain.
3. Add Pesapal consumer key and secret in Vercel.
4. Sign in as owner, open **Integrations**, and register the IPN endpoint.
5. Copy the returned IPN ID into `PESAPAL_IPN_ID` in Vercel and redeploy.
6. Reception must confirm a booking and assign a room before a guest can pay the 30% deposit using `/booking/deposit`. The payment status is only updated after the server queries Pesapal transaction status from the IPN notification.
7. Test with sandbox credentials before switching to live credentials. Set `PESAPAL_ENVIRONMENT=live` and `PESAPAL_BASE_URL=https://pay.pesapal.com/v3`.
## Vercel
Import the repository, choose the Next.js preset, configure all environment variables from `.env.example`, and deploy. Never commit secrets to GitHub.
## Still to complete
Housekeeping room status workflow, complete manager tools for all departments, full owner reports and exports, food orders, expense approvals, leave management, staff PIN login, and final production acceptance tests. Deposit checkout is only available for confirmed bookings with an assigned room. Deposit is calculated as 30% of the room total.
## Payment security
Pesapal's callback and IPN do not prove payment completion. The application queries Pesapal's GetTransactionStatus endpoint and compares amount, currency, merchant reference and tracking ID before marking a payment completed. Never treat the browser return page as proof of payment.
