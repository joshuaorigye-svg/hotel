import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendHotelEmail, escapeHtml } from "@/lib/email";
import { hotel } from "@/config/hotel";

type EventType = "confirmed" | "declined" | "checked_in" | "checked_out";

function ugandaPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("256") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "256" + digits.slice(1);
  if (digits.length === 9) return "256" + digits;
  return null;
}

function messageFor(event: EventType, guest: string, booking: any) {
  const stay = booking.check_in + " to " + booking.check_out;
  const ref = booking.id.slice(0, 8).toUpperCase();
  const messages: Record<EventType, { subject: string; text: string }> = {
    confirmed: { subject: "Your hotel booking is confirmed", text: `Hello ${guest}, your stay at ${hotel.name} is confirmed for ${stay}. Booking reference: ${ref}. Please contact reception on ${hotel.phone} if you need help.` },
    declined: { subject: "Update on your hotel booking request", text: `Hello ${guest}, we are unable to confirm your booking request for ${stay}. Please contact ${hotel.name} reception on ${hotel.phone to discuss other available dates. Reference: ${ref}.` },
    checked_in: { subject: "Welcome to Buladde Palm Villa Hotel", text: `Welcome ${guest}! Your check-in at ${hotel.name} is complete. We wish you a pleasant stay. For assistance, contact reception on ${hotel.phone}. Reference: ${ref}.` },
    checked_out: { subject: "Thank you for staying with us", text: `Thank you ${guest} for staying at ${hotel.name}. Your checkout is complete. We hope to welcome you again. Safe travels! Reference: ${ref}.` },
  };
  return messages[event];
}

async function sendSms(phone: string, message: string) {
  const username = process.env.AT_USERNAME, apiKey = process.env.AT_API_KEY;
  if (!username || !apiKey) return { channel: "sms", sent: false, reason: "Africa's Talking is not configured" };
  const to = ugandaPhone(phone);
  if (!to) return { channel: "sms", sent: false, reason: "Guest phone number is not a valid Uganda number" };
  const body = new URLSearchParams({ username, to: "+" + to, message });
  if (process.env.AT_SENDER_ID) body.set("from", process.env.AT_SENDER_ID);
  try {
    const response = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", apiKey },
      body,
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) return { channel: "sms", sent: false, reason: result?.SMSMessageData?.Message || "SMS provider rejected the request" };
    return { channel: "sms", sent: true };
  } catch {
    return { channel: "sms", sent: false, reason: "SMS provider could not be reached" };
  }
}

export async function POST(request: Request) {
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const { data: allowed } = await db.rpc("can_manage_front_desk");
    if (!allowed) return NextResponse.json({ error: "Front Desk or owner access required" }, { status: 403 });

    const body = await request.json();
    const bookingId = String(body.bookingId || "");
    const event = String(body.event || "") as EventType;
    if (!/^[0-9a-f-]{36}$/i.test(bookingId) || !["confirmed", "declined", "checked_in", "checked_out"].includes(event)) {
      return NextResponse.json({ error: "Invalid notification request" }, { status: 400 });
    }
    const { data: booking, error } = await db.from("bookings")
      .select("id,guest_name,guest_email,guest_phone,check_in,check_out,status")
      .eq("id", bookingId).single();
    if (error || !booking) return NextResponse.json({ error: "Booking not found or access denied" }, { status: 404 });

    const expected: Record<EventType, string> = { confirmed: "confirmed", declined: "cancelled", checked_in: "checked_in", checked_out: "checked_out" };
    if (booking.status !== expected[event]) return NextResponse.json({ error: "Booking status does not match this notification" }, { status: 409 });

    const copy = messageFor(event, booking.guest_name, booking);
    const results: { channel: string; sent: boolean; reason?: string }[] = [];
    if (booking.guest_email) {
      const email = await sendHotelEmail({
        to: booking.guest_email,
        subject: copy.subject + " | " + hotel.shortName,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#183b2d"><h2>${escapeHtml(copy.subject)}</h2><p>${escapeHtml(copy.text)}</p><p style="color:#777;font-size:13px">${escapeHtml(hotel.name)} · ${escapeHtml(hotel.address)} · ${escapeHtml(hotel.phone)}</p></div>`,
      });
      results.push({ channel: "email", sent: email.sent, ...(!email.sent ? { reason: email.reason } : {}) });
    }
    if (booking.guest_phone) results.push(await sendSms(booking.guest_phone, copy.text));
    return NextResponse.json({ success: results.some(r => r.sent), results, message: results.some(r => r.sent) ? "Guest notification sent." : "No notification channel is configured or available." });
  } catch {
    return NextResponse.json({ error: "Could not send guest notification." }, { status: 500 });
  }
}
