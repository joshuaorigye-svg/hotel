# Buladde Palm Villa Hotel Platform
Next.js 14 App Router, Supabase PostgreSQL/Auth, Tailwind CSS, Vercel. Planned integrations: Pesapal and Resend.
## First delivery
The repository is being converted from its original portfolio template. This phase establishes the Next.js App Router, Supabase client setup, staff sign-in, owner-only layout and live owner dashboard. Dashboard figures come from Supabase and are not fabricated. Public landing page is an initial shell; booking, staff and manager workflows, Pesapal checkout/IPN and Resend confirmation emails are later phases.
## Setup
1. Node.js 20+. Copy `.env.example` to `.env.local`.
2. Create a Supabase project. Set the public URL and anon key.
3. Apply `supabase/migrations/0001_hotel_core.sql` in Supabase SQL Editor.
4. Create the owner identity in Supabase Authentication. Insert a matching `public.profiles` row with the Auth UUID and role `owner`. Never commit credentials.
5. Run `npm install` and `npm run dev`.
6. Configure Supabase Auth Site URL and allowed redirect URLs for localhost and production.
## Staff
Create each account in Supabase Auth, then add a profile row using that Auth UUID, name, phone, role and department. Managers must have one department. Do not expose the service-role key in client code.
## Rooms
Insert into `public.rooms`: room number, type, nightly rate in UGX, facilities and status. Store photos in Supabase Storage and put their URLs in `image_urls`.
## Vercel
Import this repo, add the environment variables from `.env.example`, use the Next.js preset and deploy. Add the production URL to Supabase Auth redirect URLs.
## Security
RLS is the authorization boundary. Service-role, Pesapal and Resend secrets remain server-only. Pesapal status must be confirmed through verified server-side IPN, not a browser redirect. No default staff passwords are stored in source control.
