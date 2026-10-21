# Going live: Supabase and Render

This guide puts ProductFlow AI on the internet with real accounts:

- **Supabase** (free tier is enough to start) holds the database and the user accounts, and sends the sign-up and
  password-reset emails.
- **Render** runs the app as one web service: the API, which also serves the web app from the same address.

You need a GitHub account with this repository, an Anthropic API key, and Node.js 22 on your computer for step 2.
Allow about 30 minutes.

## 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and click **New project**.
2. Choose a name (for example `productflow-ai`), a strong **database password** (save it in a password manager), and
   the region closest to your users. Click **Create new project** and wait a minute or two.
3. Open **Project Settings → General** and copy the **Project ID** (also called the reference, a string like
   `abcdefghijklmnopqrst`). You need it in step 2.

## 2. Create the database tables

The tables, security rules and functions are in `supabase/migrations`. Apply them with the Supabase CLI from the
repository folder on your computer:

```bash
npm install
npx supabase login                               # opens the browser to authorise the CLI
npx supabase link --project-ref <your-project-id>  # asks for the database password from step 1
npx supabase db push                             # applies every file in supabase/migrations, in order
```

`db push` lists the four migrations and asks for confirmation. When it finishes, **Table Editor** in Supabase shows
tables such as `projects`, `processes` and `stories`.

No CLI? In Supabase open **SQL Editor**, and run the four files in `supabase/migrations` one at a time, in file-name
order (paste the whole file, click **Run**). Run each file only once.

## 3. Set up sign-in (Authentication)

The app's sign-in page is already built: **Sign in**, **Create an account** and **Forgot your password?**, with a
**Choose a new password** page opened from the reset email. It uses Supabase Auth, so the remaining setup is in
Supabase under **Authentication**:

1. **Sign In / Providers → Email**: make sure **Email** is enabled. Keep **Confirm email** on, so people must confirm
   their address before they can sign in. Set the minimum password length to **8** to match the app's hint.
2. **URL Configuration**: you fill this in after step 5, when you know the app's address.
   - **Site URL**: `https://<your-app>.onrender.com`
   - **Redirect URLs**: add `https://<your-app>.onrender.com/**`, and `http://localhost:5173/**` if you also run the
     app locally against this project. The confirmation and password-reset emails only link to addresses on this list.
3. **Emails → SMTP Settings** (strongly recommended before inviting others): Supabase's built-in email sender is for
   testing only and sends just a few emails per hour. Connect an email provider (for example Resend, Postmark or
   SendGrid): enable custom SMTP and enter the host, port, user, password and a sender address from that provider.
4. **Emails → Templates** (optional): adjust the wording of **Confirm signup** and **Reset password**. Keep the
   `{{ .ConfirmationURL }}` link in each template.

## 4. Copy the keys

In Supabase open **Project Settings → API Keys** (on older projects: **Project Settings → API**) and note:

| Value                                                        | Used as                                          |
| ------------------------------------------------------------ | ------------------------------------------------ |
| Project URL, e.g. `https://abcdefghijklmnopqrst.supabase.co` | `SUPABASE_URL` and `VITE_SUPABASE_URL`           |
| `anon` key (or the **publishable** key)                      | `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY` |
| `service_role` key (or a **secret** key)                     | `SUPABASE_SERVICE_ROLE_KEY`, on the server only  |

The anon key is public by design: every query made with it is limited by the database's row level security. The
service-role key bypasses those rules, so it goes only into Render's server settings: never into a `VITE_` variable,
the code, or a chat.

## 5. Deploy on Render

`render.yaml` in this repository describes the service, so Render can set it up from the file:

1. Sign in at [render.com](https://render.com) with GitHub and allow it to access this repository.
2. Click **New → Blueprint**, pick the repository, and choose the branch to deploy (the branch holding this code,
   for example `main` once it is merged).
3. Render asks for the values marked in `render.yaml`. Enter the Supabase values from step 4, your
   `ANTHROPIC_API_KEY`, and for `CORS_ORIGIN` the address Render shows for the service (for example
   `https://productflow-ai.onrender.com`). If you do not know the address yet, enter a placeholder, finish, then
   correct it under the service's **Environment** tab and redeploy.
4. Click **Apply**. The first build takes a few minutes. When the service shows **Live**, open its address:
   `/api/health` answers `{"status":"ok"}` and the root shows the sign-in page.
5. Go back to Supabase step 3.2 and enter this address as the Site URL and redirect URL.

The free Render plan sleeps after a period without visits; the first request after that takes about a minute.
A paid instance stays awake.

## 6. First sign-in

1. Open the app and click **Create an account**. Enter your name, email and a password.
2. Open the confirmation email and click the link. It brings you back to the app, signed in.
3. Click **Create your first project**. You become its **Administrator**.
4. To add your team: each person creates an account first, then you add them by email under **Users & Roles** with
   their role (Product Owner, Business Analyst, Developer or Business User).

Forgotten passwords: **Forgot your password?** on the sign-in page sends a reset link; it opens **Choose a new
password**.

## 7. Updating the live app

- **Code:** push to the deployed branch. Render rebuilds and redeploys automatically.
- **Database:** when a change adds a file to `supabase/migrations`, run `npx supabase db push` again before or with the
  deploy. Migrations already applied are skipped.

## Troubleshooting

| What you see                                                       | What to check                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| "Configuration needed" page                                        | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` were missing when Render built the app. Add them and redeploy. |
| The confirmation or reset link opens localhost or an error         | Supabase **URL Configuration**: Site URL and Redirect URLs must be the Render address (step 3.2).             |
| "Email not confirmed" when signing in                              | Click the link in the confirmation email. Check spam; set up custom SMTP if emails do not arrive (step 3.3).  |
| "Email rate limit exceeded"                                        | The built-in email sender's limit was reached. Set up custom SMTP (step 3.3).                                 |
| "Delivery features are not configured on this server"              | `SUPABASE_SERVICE_ROLE_KEY` is missing on Render.                                                             |
| AI buttons report "The AI service rejected the server credentials" | `ANTHROPIC_API_KEY` on Render.                                                                                |
| Render deploy fails at start with "Invalid API configuration"      | The log names the missing setting. Add it under **Environment** and redeploy.                                 |
