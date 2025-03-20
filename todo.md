Bugs
===

- Users can have the same username
- Avatars use emojis instead of an image
- When receiving a new PM, it's added to the bottom of the chat window (should be hidden)
- Fix message & username sanitization
- PM history is broken and no longer storing/retrieving properly
- Reconnecting while in a PM duplicates the tab

Add
===

- Electron app
- User ID next to username in gray parenthesis, I.E. "Username (2W0SVC12237)" (or show user ID upon hover)
- Ability to specify image URL for avatars (or upload files as base64?)
- 'x' button on PM tabs
- Limit how fast users can change usernames, avatars, and statuses
- Persistence for user IDs (only change upon username change)
- Emoji menu
- GIFs menu
- Add faux voice/video call buttons (for later implementation)
- File transfer (warn upon download of PDF, EXE, or other risky file types?)
  - Limit to specific whitelist of file types
- /me command and support for other /commands

Improve
===

- Expand settings menu
- Further utilize & look into Tailwindcss
- Create some kind of logo & favicon
- (once electron is added) Add window UI buttons
- Support more than LAN
