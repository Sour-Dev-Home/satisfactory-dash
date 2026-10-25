Source: https://www.freedesktop.org/software/systemd/man/latest/systemd-creds.html and https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html ("latest" on the capture date)
Captured: 2026-10-25
Method: plain HTTPS GET through a page-reading tool that returned the passages below; the quotes are the tool's, not re-checked against the raw HTML, so re-read the pages before building on a detail. The `systemd.exec` page is long and the tool read only part of it (the `LoadCredentialEncrypted=` entry and the "Added in version" lines were not in what it returned).
Source kind: official systemd documentation (LGPL-2.1-or-later project; quoted excerpts only).
Why it is here: ADR-0057 (hosting coverage), the Linux agent's secret store: an alternative to Windows DPAPI.
FINDINGS (as the pages state them):
  - `systemd-creds` encrypts with a host key kept in `/var/lib/systemd/credential.secret`, "only accessible to the root user", or with a TPM2 key, or both; `--with-key=auto` uses TPM2 if found and not in a container, else the host key if `/var/lib/systemd/` is persistent (E1).
  - A service receives an encrypted credential through `LoadCredentialEncrypted=` and reads it from the directory in `$CREDENTIALS_DIRECTORY` (E1, E2).
  - `--with-key=null` gives no confidentiality (E1).
  - `DynamicUser=` and the other user and group options are for system services only (E3).
NOT FOUND (recorded, not guessed):
  - The systemd version that added `systemd-creds` / `LoadCredentialEncrypted=`, and the version in Debian 13 and Ubuntu LTS: [NEEDS VERIFICATION] (the rehearsal checks `systemd --version` and runs the round trip).
  - What happens to a host-key credential when a VM disk is cloned or restored elsewhere: the page does not say.

### E1 — systemd-creds: keys and delivery

```
A secret key stored in the `/var/lib/systemd/credential.secret` file which is only accessible to the root user.
the credential secured in this way can only be decrypted again by the local machine.
Under `--with-key=auto`, the TPM2 key is used if a TPM2 device is found and not running in a container. The host key is used if `/var/lib/systemd/` is on persistent media.
The resulting file may be referenced in the `LoadCredentialEncrypted=` setting in unit files
`--with-key=null` uses a zero-length key, so it provides no confidentiality or authenticity.
```

### E2 — systemd.exec: credentials reach a service as files

```
When available, the location of credentials is exported as the `$CREDENTIALS_DIRECTORY` environment variable
The data is accessible from the unit's processes via the file system, at a read-only location
```

### E3 — systemd.exec: DynamicUser

```
DynamicUser=: When set, "a UNIX user and group pair is allocated dynamically when the unit is started" and released when it stops. (Added in version 232.)
```
