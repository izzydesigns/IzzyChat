Bugs
===

- No indication when message sending failed or why (mostly when a user goes offline during a PM session)
  - Messages should be gray, marked as (Pending), and next time user is online, attempt to re-send the msg
- No clear indication or differentiation between users who share the same username
  - Display client ID somewhere? on hover in online users list?
- It appears the chat messages are ALL re-fetched every time the user switches tabs, leading to possible performance issues
- No notifications when a user changes names (broadcast System msg into lobby chat & any pre-existing PM chats)
- No profanity filter (add settings option to enable/disable and update all text automatically)

Add
===

- 'x' button on tabs
- Clicking logo/server title opens browser outside of electron, into the chat via browser instead (or refreshes page)
- /me command and support for other /commands
- Broadcast username update changes to all relevant chat windows
- Add faux voice/video call buttons to the UI (non-functional for now)
- Embedded links as clickable URLs that open in the system's default browser (outside the electron app)
- Add ability to translate messages to your preferred language automatically or as desired! (built in browser translate?)
- Emoji menu & list of most used emojis
- GIFs menu & embedded GIFs, ability to favorite gifs
- Add message read receipts (and ability to disable them per user)
- Ability to send messages to offline users, mark as pending and send to recipient upon next connect
- Ability to specify fontawesome icons as avatars too (create emoji menu first)
- Add friend requests and PM requests from other users
  - If incoming user PM is not a friend, show PM request, otherwise create PM tab immediately
  - PM requests lead to datachannel creation but no friend request, closing will require approval of another PM request
- File transfer (warn upon download of PDF, EXE, or other risky file types?)
  - Limit to specific whitelist of file types in config.json
- Ability to create new "hub" tabs that others cannot remove
  - Requires basic permissions implementation first!
- Initial server configuration/setup page (and admin page to change server information)
  - See for inspiration: https://github.com/Promingy/PixelChat
- Add basic rank permissions
  - Add admin panel to edit other user's permission levels (requires updating the permissions.json file itself)
  - Upon server configuration/setup, populate permissions.json with that user's clientId and assign allPerms automatically
  - Add visual indicators of user rank somewhere (replace online-status area with colored dot instead?)

Improve
===

- Improve UX !!! IN PROGRESS !!!
  - !!! IN PROGRESS !!! - Visual indicator for when a tab contains unread messages (background pulses or something)
  - Add soft notification sound to incoming PM messages when that PM tab isn't currentTab
  - Add app settings such as notification volume, background color, notification toggle, etc...
  - Update current settings menu to have tabs for profile settings, app settings, and about page
- Limit how fast users can change usernames, avatars, and statuses (overall audit on rate limit)
- Track previous alias changes for users
  - Maybe send a system message on connect and loaded clientId with username that doesn't match localstorage value
  - Maybe hovering over user in users list shows "Previous Aliases" area with last 3 username changes (store in server)
- Display all previously connected users for the server session in sidebar for all clients (persistent user history)
  - Must add offline message handling first, otherwise starting PMs with offline people is impossible!

Unique Ideas
===

- Add crown icon next to people with elevated privileges similar to Jmods in Runescape
- Visible on hover, number of times you've used each emoji (since we track it for most used emojis in emoji menu)
- Create a gif library where all gifs "starred" are saved. Create custom categories for gifs as user desires
- Send audio clips back and forth via chat messages
  - Ability to record over previous recording? (allows for some funny moments or creations!)
  - Simple voice changer features for even more funny moments?
- Recreate BlahTherapy system for venting and listening anonymously!
- Ability to stream music to each other (music files at first) and live scrub together
  - Also allow queueing and skipping
  - Add cool music visualizers like milkdrop? (interactive!)