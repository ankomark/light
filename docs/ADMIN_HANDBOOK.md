# Adventist Life — Admin handbook

For everyone who runs the app: super admins, moderators and staff with a role.

## 1. Getting in

1. Open the menu and tap **Admin**. The app asks the server who you are every time; if you are not an admin (or no longer one) you are sent back Home.
2. **The first time**, set up two-step sign-in:
   - Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).
   - Tap **Set it up**, then **Open in authenticator app** (or type the key shown into the app).
   - Enter the 6-digit code it shows. You get **ten backup codes**: save them somewhere safe; each opens the admin tools once if you lose your phone. They are shown only once.
3. **Every time after**, enter the code from your authenticator app. Your admin session lasts **12 hours**.
4. **Dangerous actions** (giving or taking roles, banning, bulk changes, broadcasts, maintenance and switches) ask for a **fresh code** if you have not entered one in the last 10 minutes.
5. When you are done, open **More** and tap **Sign out of admin**.

Five wrong codes in a row lock the code box for 15 minutes, and the super admins are told.

Lost your phone? Ask a super admin to **Reset two-step sign-in** on your account (Users → your account), then set it up again.

## 2. Ranks and roles

| Rank | Who | Can act on |
|---|---|---|
| Super admin | Holds every power; gives and takes roles | Moderators, staff, members |
| Moderator | Every moderation power (not roles) | Staff with a role, members |
| Staff with a role | Only the powers in their role | Members |

- Nobody acts on an admin of their own rank or above, and nobody changes their own role.
- The last super admin cannot be removed.
- **Removing someone from the admins** (or suspending or banning an admin) ends their admin sessions and **signs them out on every device at once**.
- Super admins build roles under **Roles** from these powers:

| Power | What it allows |
|---|---|
| View analytics | Analytics and insights, CSV download |
| Handle reports | The reports queue |
| Remove / restore content | Take content down and bring it back |
| Suspend & warn users | Warnings (strikes) and suspensions |
| Ban users | Bans (no more sign-in) |
| Review appeals | Suspension appeals and song disputes |
| View audit log | The audit trail and its check |
| Manage app wallpapers | The pictures behind the pages |
| Post notices & answer notes | The notice board and the notes members send the admins |
| Marketplace categories | The marketplace's fixed category list |
| Write & edit quiz questions | The quiz question bank |
| Word puzzle themes | The puzzle's subjects and their order |
| Give the verified tick | Ticks for artists, sellers, services, organizations |
| Broadcast | A notification to everyone or a group |
| Maintenance & switches | Maintenance mode, parts of the app on/off |

## 3. Finding your way: Pulse and the tabs

The tabs **Pulse, Reports, Users, Content, Appeals** and **More** sit along the top on a phone and down the left on a wide screen; you see only the ones your powers cover. Every other tool (notices, broadcast, app control, ticks, quiz, puzzles, wallpapers, the detailed analytics, the audit log, roles) is under **More**.

**Pulse** is the dashboard. With the analytics power it shows, for the period you pick (7, 14, 30 or 90 days):
- how many people are online now;
- four rings: members active this week, reports handled within a day, appeals answered, and admins with two-step sign-in (red when someone has not set it up);
- sign-ups and reports day by day;
- why people report;
- the busiest hours for new posts (East Africa time);
- what people shared (posts, tracks, products, stories);
- the most followed accounts.

Without the analytics power it shows the counts. Either way, **Needs you now** lists the reports waiting.

## 4. Everyday moderation

**Reports.** Shown most-reported first (tap to switch to newest first). A report marked **Repeat offender** is on something by someone who already has strikes.
- **Resolve** when you have dealt with it, **Dismiss** when nothing is wrong, **Remove** to take the content down.
- Taking something down **asks why**: the author is told the reason, and it is kept in the audit log.
- **Take it** assigns the report to you so others know you are on it; add a note for the next moderator.

**Users.** Search, or filter Admins / Suspended / Banned / Warned. Tap someone for:
- **Warn**: a strike, with a reason. Three strikes suspend the account for 7 days automatically.
- **Suspend**: 1, 7, 30 days or until lifted, with a reason.
- **Ban**: they can no longer sign in, with a reason.
- **History**: reports against them, reports they made, every admin action on them, devices signed in.
Actions do not appear on admins of your rank or above.

**Content.** Content posted by an admin of your rank or above cannot be taken down by you (in bulk it is skipped). The author is told when something is taken down, with the reason, and when it comes back. Browse any kind of content, search, show taken-down items, take down or restore (singly or in bulk). A song can be taken down for **copyright** or for **breaking the rules**; the uploader is told which and may dispute it (Appeals).

**Appeals.** Approving a suspension appeal lifts the suspension; approving a song dispute restores the song. Either way the person is told.

## 5. Running the app

- **Broadcast**: pick who (everyone, active this week, sellers, artists, admins); the reach is shown before sending. One broadcast every 30 minutes. People who turned off notices are not sent it.
- **App control**:
  - **Maintenance mode**: members see your message instead of the app; admins still get in. Write when you expect to be back.
  - **Parts of the app**: switch Marketplace, Bible quiz, Word puzzle or Going live off; their buttons and menu items disappear for members.
- **Quiz questions**: write questions (2–4 answers, tick the right one, a reference and a teaching line). Questions the quiz retired itself (almost everyone right or wrong) say why: check the answer before bringing one back.
- **Puzzle themes**: on/off, order (arrows), names in English and Kiswahili, new themes from some books, a passage or a word. A theme with levels keeps its source.
- **Verified ticks**: give only once you are sure who runs the account; taking a tick asks why and the owner is told.
- **Notice board** and **Wallpapers**: from the dashboard.

## 6. The audit log

Every admin action is written down: who (kept by name even if the account is deleted), what, to what, why, and from which IP address and device.

Each entry is **chained** to the one before it. **Check the trail** confirms nothing has been changed or deleted since it was written; if something has, it shows the first entry where the chain breaks. Report that to the super admins at once.

## 7. Alerts

Super admins get a push (at most once an hour for the same thing) when:
- one item gets **5 or more reports within an hour**;
- one admin **bans 10 or more accounts within an hour**;
- an admin opens the admin tools **from a new device or place**;
- an admin's code box is **locked after too many wrong codes**;
- a super admin **resets someone's two-step sign-in** (that admin is told as well).

## 8. Good practice

- Give a clear, kind reason: the person reads it.
- Prefer a warning before a suspension, and a suspension before a ban, unless the content is dangerous.
- Never share your authenticator codes or backup codes; nobody from the team will ask for them.
- Sign out of admin on shared devices.
- Use roles with only the powers someone needs.

## 9. For the technical team (deploying)

- Migrations up to `0170` (two-step sign-in, admin sessions, the audit chain, app settings, broadcasts).
- Set `ADMIN_SECRET_KEY` (encrypts the authenticator secrets; changing it later means every admin sets up two-step sign-in again).
- Leave `DJANGO_ADMIN_ENABLED` off in production (Django's own `/admin/` site signs in with a password alone); when on, only superusers get in.
- Use a shared cache (`REDIS_URL`) so maintenance mode and admin-code limits apply across all server workers at once.
- `ADMIN_2FA_REQUIRED` must stay `True` in production.
- Set `TRUSTED_PROXY_COUNT` to the number of proxies in front of the server (nginx alone: `1`). The audit log's IP addresses and the new-device alert believe only the addresses those proxies add.
