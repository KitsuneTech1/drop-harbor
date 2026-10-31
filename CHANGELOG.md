# Changelog

## v1.0.0

First open source release. Drop Harbor uploads up to 12 files at a time, gives each one
a public download link backed by a random UUID, and filters your library by filename as
you type. Every upload gets a lifetime, from one hour to never, and a background sweep
deletes expired files and orphaned partials off disk. A shared token guards uploads and
deletes while downloads stay public, and that token is now checked before anything is
written, so a bad token never touches your disk. Stored paths are resolved and
boundary-checked before being served, filenames and extensions are sanitized and
length-capped, and `X-Content-Type-Options: nosniff` is set on every response. Orphan
cleanup leaves a file alone for its first hour, so a sweep cannot delete an upload that
is still in progress. Ships with an eight-test suite on the built-in `node:test`
runner, GitHub Actions CI, a Dockerfile, and a deploy script for Proxmox LXC. Needs
Node 18 or newer and three dependencies.