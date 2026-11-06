import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const reference = String(body.booking_reference || "").trim();
    const phone = String(body.phone || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(reference) || phone.length < 7 || phone.length > 30) {
      return NextResponse.json({ error: "Enter a valid booking reference and phone number." }, { status: 400 });
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return NextResponse.json({ error: "Booking lookup is temporarily unavailable." }, { status: 503 });
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc("get_guest_booking_portal", { p_booking_id: reference, p_phone: phone });
    if (error || !data) return NextResponse.json({ error: "Booking reference or phone number is incorrect." }, { status: 404 });
    return NextResponse.json({ success: true, booking: data }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Could not retrieve the booking. Please try again." }, { status: 500 });
  }
}
