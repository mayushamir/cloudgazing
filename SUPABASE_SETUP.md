# Supabase Setup for Cloudgazing

Follow these steps to set up Supabase for your Cloudgazing app.

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Choose your organization and give your project a name (e.g., "cloudgazing")
4. Set a secure database password (save this somewhere safe)
5. Choose a region close to your users
6. Click "Create new project"

## 2. Create the Database Table

Go to **SQL Editor** in your Supabase dashboard and run this SQL:

```sql
-- Create the selections table
CREATE TABLE selections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  what TEXT NOT NULL,
  name TEXT NOT NULL,
  path_data TEXT NOT NULL,
  points JSONB NOT NULL,
  png_url TEXT
);

-- Enable Row Level Security (RLS)
ALTER TABLE selections ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read selections (public gallery)
CREATE POLICY "Allow public read access"
  ON selections
  FOR SELECT
  TO anon
  USING (true);

-- Allow anyone to insert selections (public submissions)
CREATE POLICY "Allow public insert access"
  ON selections
  FOR INSERT
  TO anon
  WITH CHECK (true);
```

## 3. Create Storage Bucket for Images

1. Go to **Storage** in the Supabase dashboard
2. Click "New bucket"
3. Name it: `cloud-images`
4. Make sure **Public bucket** is enabled (toggle ON)
5. Click "Create bucket"

Then run this SQL to allow public uploads:

```sql
-- Allow public uploads to cloud-images bucket
CREATE POLICY "Allow public uploads"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'cloud-images');

-- Allow public read access to images
CREATE POLICY "Allow public read"
  ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'cloud-images');
```

## 4. Get Your API Credentials

1. Go to **Settings** → **API** in your Supabase dashboard
2. Copy your:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (safe to use in frontend)

## 5. Update Your Config

Edit `supabase-config.js` with your credentials:

```javascript
const SUPABASE_URL = "https://your-project-id.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key-here";
```

## 6. Deploy to GitHub Pages

1. Commit and push your changes to GitHub
2. Go to your repo Settings → Pages
3. Set source to your main branch
4. Your site will be live at `https://yourusername.github.io/cloudgazing/`

---

## Security Notes

- The **anon key** is safe to expose in frontend code - it only allows operations permitted by your Row Level Security policies
- Anyone can view and submit clouds (this is intentional for a public art project)
- If you want to restrict submissions later, you can update the RLS policies

## Troubleshooting

### "Failed to load gallery"
- Check that your Supabase URL and key are correct in `supabase-config.js`
- Verify the `selections` table exists with the correct columns

### "Upload failed"
- Make sure the `cloud-images` storage bucket exists and is public
- Check that the storage policies are set up correctly

### CORS errors
- Supabase handles CORS automatically, but if you see errors, check your project URL is correct
