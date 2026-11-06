# Buladde Palm Villa Hotel Platform
A mobile-friendly hotel management platform built with Next.js 14 App Router, Supabase PostgreSQL/Auth, Tailwind CSS and Vercel. Pesapal and Resend integrations are planned for the payment/email phase.
## Current implementation
- Next.js 14 App Router foundation and green/gold branding.
- Supabase email/password authentication and protected owner, manager and staff areas.
- Owner overview, staff directory/invitations, bookings list, finance view and audit log.
- Department-scoped manager overview and staff task/attendance/issue-report workspace.
- Public home, rooms, restaurant menu, booking request, contact form and gallery placeholder.
- PostgreSQL schema with Row Level Security and audit triggers.
- Staff invitations are sent using Supabase Auth email invitations. The recipient sets their own password through the Supabase confirmation/invitation flow.
## Setup
1. Use Node.js 20+. Copy `.env.example` to `.env.local`.
2. Create a Supabase project and set the project URL, anon key and service role key. The service role key is server-only and must never use a `NEXT_PUBLIC_` prefix.
3. Apply migrations in order from `supabase/migrations` using Supabase SQL Editor or Supabase CLI.
4. Create the owner account in Supabase Authentication. Insert a matching `public.profiles` row with the same Auth UUID, full name, and role `owner`. Do not put credentials in source control.
5. Set Supabase Auth Site URL to your deployed hotel domain. Add local and production callback URLs to the allowed redirect URLs.
6. Run `npm install`, then `npm run dev`.
## Adding staff and managers
Sign in as the owner, open **Staff & teams**, and invite the person with their full name, email, phone, role and department. Supabase sends an invitation email so they can set their own password. A manager must be assigned to one department. Accounts / Finance is reserved for the owner.
For the initial requested sample roster, create the owner first, then invite three managers and five staff from the owner interface. Do not use shared default passwords or commit real staff credentials.
## Adding rooms
Insert a room in `public.rooms` with a unique room number, room type, nightly rate in UGX, facilities array and status. Upload real hotel photos to a private/public Supabase Storage bucket according to your chosen image policy and save the resulting URLs in `image_urls`. The public rooms page reads active room records.
## Menu and contact inbox
Add menu entries in `public.restaurant_menu_items`. Contact requests are saved in `public.contact_messages`; owner-only inbox UI is a follow-up build item.
## Vercel
Import this repository, select the Next.js preset, configure the environment variables from `.env.example`, and deploy. Add the production URL to Supabase Auth redirect URLs.
## Integrations still to complete
Pesapal order registration, IPN verification and payment reconciliation; Resend transactional booking and contact emails; room availability overlap checks and confirmed room assignment; exports and full finance reporting. Deposit selection currently records a preference only and does not charge a card/mobile money account.
## Security notes
Supabase RLS is the authorization boundary. The service-role key, Pesapal secrets and Resend API key must remain server-only. Payment success must be based on verified Pesapal IPN/status checks, never a browser redirect. The public booking form creates pending requests only; reception must confirm availability.
