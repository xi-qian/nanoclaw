# Changelog

All notable changes to NanoClaw will be documented in this file.

## [Unreleased]

- **fix:** Prevent duplicate container spawns when `onOutput` callback throws error (e.g., `sendMessage` failure)
  - Added try-catch in `processGroupMessages` to catch and log errors from `channel.sendMessage`
  - Previously, uncaught errors caused `outputChain` to reject, leaving `runContainerAgent` Promise pending
  - This led to `runForGroup` timeout triggering and creating a second container for the same group
  - Now errors are logged with full context (group, chatJid, error details) and container exits normally

## [1.2.0](https://github.com/qwibitai/nanoclaw/compare/v1.1.6...v1.2.0)

[BREAKING] WhatsApp removed from core, now a skill. Run `/add-whatsapp` to re-add (existing auth/groups preserved).
- **fix:** Prevent scheduled tasks from executing twice when container runtime exceeds poll interval (#138, #669)
