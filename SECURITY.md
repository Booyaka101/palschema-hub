# Security Policy

## Supported versions

The latest version published to npm is the only one that gets fixes.

## Reporting a vulnerability

Please **don't** open a public issue for a security problem.

Use GitHub's [private vulnerability reporting](https://github.com/Booyaka101/palschema-hub/security/advisories/new) instead. Expect a first response within a week.

Please include what you found, how to reproduce it, and what an attacker gets out of it.

## What this touches

A schema registry and an offline validator. The CLI reads your mod JSON locally and sends nothing anywhere.

- **The validator is offline.** It reads your mod JSON from disk and sends nothing.
- **Registry content is community-submitted.** Schemas are data, not code, and are validated on the way in, but they are not audited for accuracy.

## Scope

In scope: anything that leaks a credential, reads data belonging to someone else, or lets untrusted input reach code execution.

Out of scope: findings that require an attacker to already control the machine it runs on.
