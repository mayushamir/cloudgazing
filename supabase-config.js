// Supabase Configuration
// Replace these with your actual Supabase project credentials
const SUPABASE_URL = "https://cudvweukgnuepbzioowr.supabase.co"; // e.g., https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1ZHZ3ZXVrZ251ZXBiemlvb3dyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2OTM5MTIsImV4cCI6MjA4NTI2OTkxMn0.vDVQIpHXvvoYJpA9pf0f68peLDY4k-6Wdi9oetwHFmw"; // Your public anon key

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Storage bucket name for cloud images
const STORAGE_BUCKET = "cloud-images";

// Test connection on load
(async function testSupabaseConnection() {
  console.log("🔌 Testing Supabase connection...");
  try {
    // Test database connection
    const { data, error } = await supabaseClient.from("selections").select("count", { count: "exact", head: true });
    if (error) {
      console.error("❌ Database error:", error.message);
      console.log("💡 Make sure you've created the 'selections' table. See SUPABASE_SETUP.md");
    } else {
      console.log("✅ Database connected! Selections table exists.");
    }

    // Test storage bucket by trying to list files (works with anon key if bucket is public)
    const { data: files, error: storageError } = await supabaseClient.storage.from(STORAGE_BUCKET).list("", { limit: 1 });
    if (storageError) {
      console.error("❌ Storage error:", storageError.message);
      console.log("💡 Make sure the bucket 'cloud-images' exists and has public access enabled.");
    } else {
      console.log("✅ Storage bucket 'cloud-images' is accessible!");
    }
  } catch (err) {
    console.error("❌ Connection failed:", err);
  }
})();
