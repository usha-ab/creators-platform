export type MemberTier = 'gratis' | 'guld' | 'premium';
export type MemberRole = 'customer' | 'creator' | 'venue';
export type PlanKey =
  | 'publik_guld' | 'publik_premium'
  | 'kreator_guld' | 'kreator_premium'
  | 'upplevelse_guld' | 'upplevelse_premium';
export type ListingType = 'service' | 'event' | 'table_reservation' | 'spa_treatment' | 'group_activity' | 'package' | 'coaching_session' | 'b2b_offering';

export interface ExperienceDetails {
  amenities?: string[];
  included?: string[];
  dress_code?: string;
  age_restriction?: number;
  accessibility?: string;
}

export interface Post {
  id: string;
  user_id: string;
  text: string;
  image_url: string | null;
  listing_id: string | null;
  created_at: string;
}

export interface PostLike {
  id: string;
  user_id: string;
  post_id: string;
  created_at: string;
}

export interface FeedPost extends Post {
  author: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    category: string | null;
    role: string;
    is_public?: boolean;
    level?: number;
  };
  listing: {
    id: string;
    title: string;
    price: number | null;
    listing_type: string;
    event_date: string | null;
    event_location: string | null;
    slug: string | null;
    ticket_types?: { id: string }[];
  } | null;
  like_count: number;
  is_liked: boolean;
}

export interface Attendee {
  name: string;
  email?: string;
  dietary?: string;
}

// ─── Points & Rewards ───

export type PointAction =
  | 'like_given' | 'like_received'
  | 'follow_given' | 'follow_received'
  | 'booking_made' | 'booking_received'
  | 'review_written' | 'review_received'
  | 'post_created'
  | 'referral_signup'
  | 'profile_completed';

export interface PointEvent {
  id: string;
  user_id: string;
  action: PointAction;
  points: number;
  source_id: string | null;
  source_type: string | null;
  created_at: string;
}

export interface UserPoints {
  user_id: string;
  total_points: number;
  current_level: number;
  points_this_week: number;
  points_this_month: number;
}

export interface Reward {
  id: string;
  slug: string;
  name_sv: string;
  description_sv: string;
  reward_type: 'badge' | 'discount' | 'early_access' | 'feature';
  required_level: number;
  icon: string | null;
  discount_percent: number | null;
  is_active: boolean;
}

export interface UserReward {
  id: string;
  user_id: string;
  reward_id: string;
  unlocked_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          website: string | null;
          category: string | null;
          location: string | null;
          hourly_rate: number | null;
          is_public: boolean;
          tier: MemberTier | null;
          role: MemberRole;
          stripe_account_id: string | null;
          calendar_sync_token: string | null;
          created_at: string;
          updated_at: string;
          creator_subcategory: 'general' | 'taxi_dancer' | null;
          dance_styles: string[] | null;
          dance_languages: string[] | null;
          dance_experience_years: number | null;
          offers_coaching: boolean | null;
          coaching_hourly_rate_sek: number | null;
          coaching_specialties: string[] | null;
          coaching_bio: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at" | "updated_at" | "is_public" | "tier" | "role" | "creator_subcategory" | "dance_styles" | "dance_languages" | "dance_experience_years" | "offers_coaching" | "coaching_hourly_rate_sek" | "coaching_specialties" | "coaching_bio"> & {
          is_public?: boolean;
          tier?: MemberTier | null;
          role?: MemberRole;
          creator_subcategory?: 'general' | 'taxi_dancer' | null;
          dance_styles?: string[] | null;
          dance_languages?: string[] | null;
          dance_experience_years?: number | null;
          offers_coaching?: boolean | null;
          coaching_hourly_rate_sek?: number | null;
          coaching_specialties?: string[] | null;
          coaching_bio?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          plan: PlanKey;
          status: "active" | "canceled" | "past_due" | "trialing";
          current_period_start: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["subscriptions"]["Row"], "id" | "created_at" | "updated_at" | "status"> & {
          id?: string;
          status?: "active" | "canceled" | "past_due" | "trialing";
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Insert"]>;
      };
      payments: {
        Row: {
          id: string;
          user_id: string;
          stripe_payment_id: string | null;
          amount: number;
          currency: string;
          status: "succeeded" | "pending" | "failed";
          description: string | null;
          payment_method: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["payments"]["Row"], "id" | "created_at" | "currency" | "payment_method"> & {
          id?: string;
          currency?: string;
          payment_method?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
      };
      listings: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          category: string;
          price: number | null;
          duration_minutes: number | null;
          is_active: boolean;
          is_public: boolean;
          event_tier: string | null;
          event_date: string | null;
          event_time: string | null;
          event_location: string | null;
          release_to_gold_at: string | null;
          early_bird_start: string | null;
          early_bird_end: string | null;
          early_bird_price: number | null;
          public_sale_at: string | null;
          capacity: number | null;
          tickets_sold: number;
          image_url_square: string | null;
          content_language: string | null;
          organizer_name: string | null;
          listing_type: ListingType;
          min_guests: number;
          max_guests: number | null;
          experience_details: ExperienceDetails;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["listings"]["Row"], "id" | "created_at" | "updated_at" | "is_active" | "is_public" | "listing_type" | "min_guests" | "experience_details" | "early_bird_start" | "early_bird_end" | "early_bird_price" | "public_sale_at" | "capacity" | "tickets_sold" | "image_url_square" | "content_language" | "organizer_name"> & {
          id?: string;
          is_active?: boolean;
          is_public?: boolean;
          early_bird_start?: string | null;
          early_bird_end?: string | null;
          early_bird_price?: number | null;
          public_sale_at?: string | null;
          capacity?: number | null;
          tickets_sold?: number;
          image_url_square?: string | null;
          content_language?: string | null;
          organizer_name?: string | null;
          listing_type?: ListingType;
          min_guests?: number;
          experience_details?: ExperienceDetails;
        };
        Update: Partial<Database["public"]["Tables"]["listings"]["Insert"]>;
      };
      event_waitlist: {
        Row: {
          id: string;
          listing_id: string;
          name: string | null;
          email: string;
          source: string | null;
          unsubscribe_token: string;
          unsubscribed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          name?: string | null;
          email: string;
          source?: string | null;
          unsubscribe_token?: string;
          unsubscribed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_waitlist"]["Insert"]>;
      };
      email_broadcasts: {
        Row: {
          id: string;
          listing_id: string;
          sender_id: string;
          subject: string;
          body: string;
          cta_label: string | null;
          cta_url: string | null;
          audience: string;
          recipient_count: number;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          listing_id: string;
          sender_id: string;
          subject: string;
          body: string;
          cta_label?: string | null;
          cta_url?: string | null;
          audience?: string;
          recipient_count?: number;
          status?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["email_broadcasts"]["Insert"]>;
      };
      bookings: {
        Row: {
          id: string;
          listing_id: string;
          creator_id: string;
          customer_id: string;
          status: "pending" | "confirmed" | "completed" | "canceled";
          scheduled_at: string;
          notes: string | null;
          stripe_payment_id: string | null;
          amount_paid: number | null;
          booking_type: "manual" | "ticket";
          guest_count: number;
          special_requests: string | null;
          attendees: Attendee[];
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["bookings"]["Row"], "id" | "created_at" | "updated_at" | "status" | "booking_type" | "guest_count" | "attendees"> & {
          id?: string;
          status?: "pending" | "confirmed" | "completed" | "canceled";
          booking_type?: "manual" | "ticket";
          guest_count?: number;
          attendees?: Attendee[];
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
      };
      promo_codes: {
        Row: {
          id: string;
          code: string;
          description: string | null;
          discount_type: "percent" | "fixed";
          discount_value: number;
          scope: "subscription" | "ticket" | "both";
          allowed_plans: string[] | null;
          max_uses: number | null;
          current_uses: number;
          max_uses_per_user: number;
          valid_from: string;
          valid_until: string | null;
          is_active: boolean;
          stripe_coupon_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["promo_codes"]["Row"], "id" | "created_at" | "updated_at" | "current_uses" | "is_active" | "max_uses_per_user"> & {
          id?: string;
          current_uses?: number;
          is_active?: boolean;
          max_uses_per_user?: number;
        };
        Update: Partial<Database["public"]["Tables"]["promo_codes"]["Insert"]>;
      };
      promo_code_uses: {
        Row: {
          id: string;
          promo_code_id: string;
          user_id: string;
          used_for: "subscription" | "ticket";
          reference_id: string | null;
          discount_amount: number | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["promo_code_uses"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["promo_code_uses"]["Insert"]>;
      };
      payouts: {
        Row: {
          id: string;
          creator_id: string;
          amount_gross: number;
          amount_commission: number;
          amount_net: number;
          payout_type: "batch" | "instant";
          stripe_payout_id: string | null;
          status: "pending" | "in_transit" | "paid" | "failed";
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["payouts"]["Row"], "id" | "created_at" | "updated_at" | "status"> & {
          id?: string;
          status?: "pending" | "in_transit" | "paid" | "failed";
        };
        Update: Partial<Database["public"]["Tables"]["payouts"]["Insert"]>;
      };
    };
  };
}
