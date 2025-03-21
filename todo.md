Bugs
===

- Users can have the same username
- Fix message, username, & status sanitization
- Avatars use emojis instead of an image

Add
===

- Ability to specify image URL for avatars (or upload files as base64?)
- 'x' button on PM tabs
- Limit how fast users can change usernames, avatars, and statuses
- Emoji menu
- GIFs menu
- Add faux voice/video call buttons (for later implementation)
- File transfer (warn upon download of PDF, EXE, or other risky file types?)
  - Limit to specific whitelist of file types
- /me command and support for other /commands
- Add jQuery since we interface with the DOM so much (+ jQuery UI may be useful)
- Ability to send messages to offline users, mark as pending and send to recipient upon next connect
- Add read receipts

Improve
===

- Improve UX
  - Anchor the user to new area below "online users" list & filter user out of old list
    - Add current user to HTML, not in JS code, and update it separate from other users
  - Clicking on your own user in the users list sidebar should open the settings menu
  - Add soft notification sound to incomming PM messages when that PM tab isn't currentTab
  - Add soft outline pulse to tabs that have unread PM messages
  - Add app settings such as notification volume, background color, notification toggle, etc...
  - Current settings menu updated to have profile settings, app settings, and about page tabs
- Display all previously connected users for the server session in sidebar for all clients
- Create some kind of electron app logo and/or website favicon
- (once electron is added) Add custom window UI buttons
