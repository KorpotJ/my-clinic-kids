# Security findings

While decommissioning this project I audited the whole account rather than just switching things off. Four issues surfaced. All are closed. They are written up here in full because how they were found matters more than the fact that they existed.

Every claim below was verified against the running system. Where something was not measured, that is stated instead of guessed.

---

## 1. Files containing a real LINE user ID were reachable through CloudFront

**What.** `seed-demo.sql` and `teardown-demo.sql` had been uploaded into the same S3 bucket that serves the front ends, under `tmp/` and again under `sql/`. The seed file contained one real LINE user ID. Requesting the path through the CloudFront domain returned `200`.

**How it was found.** Not by looking for it. I was checking what the bucket held before planning the deletion order and listed its contents in full. The first pair of files appeared in a truncated listing; the second pair only appeared after listing every object and printing just the filenames.

**Scope.** The bucket itself has all four public-access blocks enabled and no bucket policy, so the files were never exposed at an S3 URL. Reaching them required knowing the CloudFront domain and the exact path — there is no directory listing. The data was one LINE user ID belonging to me, no child records, no credentials.

**Fixed.** Both pairs deleted from S3, a CloudFront invalidation issued for each prefix, and the paths re-requested until they returned `403`. A control check across the whole bucket for `.sql`, `.json`, `.env`, `.md`, `.zip`, `.txt` and `.bak` returned zero.

**What it changed.** The project's `.gitignore` had a rule covering `*.local.sql`, and the seed file had been carefully sanitised in git. All of that effort protected one distribution channel. Nobody had asked whether the file had been copied anywhere else. Source control hygiene is not data hygiene.

---

## 2. An IAM access key sat in a public S3 bucket for about six months

**What.** A bucket named `amzn-demokorpot-s3-v1`, left over from an AWS lab in March, held `admin_korpot_accessKeys.csv` — the credentials file AWS offers for download when an access key is created. The bucket had no public-access blocks and a bucket policy that made it public.

**How it was found.** By accident, and only because a delete failed. `aws s3 ls` reported the bucket as empty, so the plan was to remove it unexamined. `delete-bucket` refused with `BucketNotEmpty`: versioning was enabled and the current-version listing had been hiding three objects. Listing object versions revealed the CSV.

The timestamps make the cause obvious. The key was created at 09:33 and the CSV uploaded at 09:38 — five minutes apart, the ordinary "download the file, put it somewhere" motion.

**Scope.** `get-access-key-last-used` showed both of the account's keys were last used on 25 March, against S3, in `ap-southeast-1` and `ap-southeast-7`. Nothing since — nearly six months of silence. Billing supported that independently: monthly usage was $10, $43 and $34, all attributable to resources I created. There was no anomalous spend of the kind account compromise produces.

**Fixed.** Both keys deactivated, then the exposed one deleted permanently and a replacement issued. The bucket was left in place: it has MFA Delete enabled, which restricts version deletion to the root user, and with the keys dead there was nothing left to protect. Removing it would have meant a root login to disable a protection that was working.

**What it changed.** `aws s3 ls` shows current versions only. On a versioned bucket, an empty listing is not evidence of an empty bucket. The failed delete was the only thing standing between this and never being discovered.

---

## 3. Root access keys were configured on the development machine

**What.** `aws sts get-caller-identity` in the local shell returned an ARN ending in `:root`, not an IAM user. Root credentials were sitting in the local AWS profile.

**How it was found.** Checking whether deactivating the IAM keys in finding 2 would break local tooling. It would not have — because local tooling was not using those keys at all.

**Scope.** Local to one machine. Root MFA was already enabled, verified through `get-account-summary` returning `1 1`, so console access still required a second factor. The keys themselves carry no such requirement.

**Why it is worse than finding 2.** Root credentials cannot be scoped by IAM policy, restricted by a service control policy, or bounded by a permission boundary. There is no configuration that limits what they can do.

**Fixed.** The local profile now uses a scoped IAM user. The root access key was deleted on 9 September 2026, after CloudTrail confirmed its last use was a single read-only `GetCallerIdentity` call from my own address — nothing was depending on it. `get-account-summary` now returns `0 1`: no root keys, MFA still enforced. The stale local profile pointing at the deleted key was removed as well.

---

## 4. A compliance claim in the documentation was not true

**What.** The project's internal notes stated that all data stays in `ap-southeast-7` and does not leave Thailand. The S3 origin behind CloudFront is in `ap-southeast-1` (Singapore).

**How it was found.** Reading the CloudFront distribution's origin while planning what to delete. It had never been questioned because the notes already answered it.

**Scope.** That bucket holds HTML, CSS, JavaScript and two images — no personal data. RDS, Lambda and Cognito are all in `ap-southeast-7`, so the substance of the claim held. The wording did not.

**Fixed.** The claim is now phrased as what was measured: personal data is stored in `ap-southeast-7`; public application assets are served from CloudFront with an origin in `ap-southeast-1`.

**What it changed.** This one was never going to cause a breach. It would have caused something else — a statement in a privacy notice that a user could check and find false. Documentation drifts from reality silently, and a compliance claim that nobody re-measures is a claim about the past.

---

## What generalises

**A clean result on one channel says nothing about the others.** The seed file was clean in git and exposed through CloudFront. Both were true at the same time.

**Absence of output is not absence of data.** `aws s3 ls` returned nothing on a bucket holding an access key. Every check in this audit that produced an empty result was re-run a second way before it was believed.

**Errors are evidence.** `BucketNotEmpty` was the only reason finding 2 was ever discovered. A command that fails is telling you something the successful path would not have.

**Names describe intentions, not behaviour.** A function called `staff-manage` writes to no database. A file header that says "placeholder" sat above a real credential. A bucket named for an app serves an admin console. Every name in this system was checked against what the code actually did.
