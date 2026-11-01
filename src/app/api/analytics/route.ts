import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Fetch all completed bookings for this creator in the last 6 months
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, status, created_at, updated_at, listing_id, listings(title, price, category, event_date)')
    .eq('creator_id', user.id)
    .gte('created_at', sixMonthsAgo.toISOString())
    .order('created_at', { ascending: true });

  const allBookings = bookings ?? [];

  // Monthly revenue and booking counts
  const monthlyStats: Record<string, { revenue: number; bookings: number; completed: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyStats[key] = { revenue: 0, bookings: 0, completed: 0 };
  }

  for (const b of allBookings) {
    const month = b.created_at.slice(0, 7); // YYYY-MM
    if (monthlyStats[month]) {
      monthlyStats[month].bookings++;
      if (b.status === 'completed') {
        monthlyStats[month].completed++;
        const price = (b.listings as any)?.price ?? 0;
        monthlyStats[month].revenue += price;
      }
    }
  }

  // Top services by booking count
  const serviceMap = new Map<string, { title: string; category: string; eventDate: string | null; count: number; revenue: number }>();
  for (const b of allBookings) {
    const listing = b.listings as any;
    if (!listing) continue;
    const existing = serviceMap.get(b.listing_id) ?? {
      title: listing.title,
      category: listing.category,
      eventDate: listing.event_date ?? null,
      count: 0,
      revenue: 0,
    };
    existing.count++;
    if (b.status === 'completed') {
      existing.revenue += listing.price ?? 0;
    }
    serviceMap.set(b.listing_id, existing);
  }

  const topServices = Array.from(serviceMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Status breakdown
  const statusCounts = { pending: 0, confirmed: 0, completed: 0, canceled: 0 };
  for (const b of allBookings) {
    if (b.status in statusCounts) {
      statusCounts[b.status as keyof typeof statusCounts]++;
    }
  }

  // Summary stats
  const totalRevenue = allBookings
    .filter((b) => b.status === 'completed')
    .reduce((sum, b) => sum + ((b.listings as any)?.price ?? 0), 0);
  const totalBookings = allBookings.length;
  const completionRate = totalBookings > 0
    ? Math.round((statusCounts.completed / totalBookings) * 100)
    : 0;

  // Current month stats
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = monthlyStats[currentMonthKey] ?? { revenue: 0, bookings: 0, completed: 0 };

  // Previous month for comparison
  const prevDate = new Date(now);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevMonth = monthlyStats[prevMonthKey] ?? { revenue: 0, bookings: 0, completed: 0 };

    return NextResponse.json({
      summary: {
        totalRevenue,
        totalBookings,
        completionRate,
        currentMonthRevenue: currentMonth.revenue,
        currentMonthBookings: currentMonth.bookings,
        prevMonthRevenue: prevMonth.revenue,
        prevMonthBookings: prevMonth.bookings,
      },
      monthlyStats: Object.entries(monthlyStats).map(([month, stats]) => ({
        month,
        ...stats,
      })),
      topServices,
      statusCounts,
    });
  } catch (error) {
    console.error("Route error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
