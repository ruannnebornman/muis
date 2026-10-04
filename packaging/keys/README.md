# muis release signing key

Public material for the OpenPGP key that signs muis release artifacts.

```text
UID:              muis release signing <mail@ruannebornman.com>
Primary:          58D8 93B6 ADD9 EAF9 119F  971E 204E 1FDA 96E1 D689
Signing subkey:   B438 B3F6 C82B 3163 97CF  260C 2850 3E3D 3E1D 5FC6
Algorithm:        Ed25519 (certify-only primary, sign-only subkey)
Created:          2026-10-04
Expires:          2031-10-03
```

Files:

- `muis-release.gpg` — binary keyring, used with `gpgv --keyring`.
- `muis-release.asc` — armored copy for humans and release attachments.
- `muis-trusted` — the primary fingerprint to pin against.

The private key never lives in this repository. The primary secret key is held
offline; release automation receives a passphrase-protected signing subkey via
the protected `release` GitHub Environment (`MUIS_GPG_PRIVATE_KEY`,
`MUIS_GPG_FPR`, `MUIS_GPG_PASSPHRASE`).

## Verify a release artifact

```sh
gpgv --keyring packaging/keys/muis-release.gpg \
  muis-<version>-x86_64-linux.tar.gz.sig \
  muis-<version>-x86_64-linux.tar.gz
```

## Rotation

Routine change is a new signing subkey under the same primary fingerprint.
Replacing the primary fingerprint is a staged, reviewed transition. A suspected
compromise follows the same emergency response as any signing key: stop
signing, preserve evidence, revoke from the offline primary, and publish an
authenticated notice before resuming.
