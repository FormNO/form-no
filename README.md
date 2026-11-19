# Form N-O: Rejection Wall

A wall where people write what they refuse. Filings are written to Robinhood Chain as
event logs, where they cannot be edited or removed.

Visitors sign in with the X account they already have. No wallet, no new
account, no gas. The application signs the transaction and covers the fee.

The site runs in two phases, and the code handles both:

**Phase one, no chain yet.** People sign in and file. Each filing is recorded
with its number and its place in the order. The site says plainly that the
queue is waiting for the chain.

**Phase two, the chain is live.** You deploy the contract, set two more
variables, and run the publisher once. Everything already filed goes to Robinhood Chain in
the order it was filed, so the first person to write really is #0001. From then
on each new filing goes straight to the chain as it is made.

This way you can put the site in front of people, collect real filings, and
only spend money once it is worth spending.

```
public/index.html          the site
public/hidden.json         filings hidden from the wall
public/share.png           the card shown when a link is shared
lib/session.js             signed session cookie, no storage needed
lib/store.js               the filing store
functions/api/auth/*       sign in with X (OAuth 2.0 + PKCE)
functions/api/wall         serves the wall
functions/api/reject       records a filing, and writes it to Robinhood Chain when live
functions/api/vote         signature and objection counter
functions/api/publish      writes queued filings to Robinhood Chain, oldest first
functions/r/[id]           a page of its own for each filing
functions/u/[handle]       everything one account has filed
contracts/NoWall.sol       the contract
test/NoWall.t.sol          its test suite
script/Deploy.s.sol        one-command deployment
foundry.toml               compiler and test settings
```

Hosting is Cloudflare Pages on the free tier. No server, no domain.

---

# Phase one: get the site running

## Step 1. Create the X app

At developer.x.com, create a project and an app.

In the app's **User authentication settings**:

- App permissions: **Read**. The project never posts for anyone.
- Type of app: **Web App** (confidential client).
- Callback URI: `https://<your-site>.pages.dev/api/auth/callback`
- Website URL: your site address.

You do not know the site address yet, so either guess the project name you will
use in step 3 and come back to correct it, or do step 3 first.

Save, then copy the **OAuth 2.0 Client ID and Client Secret**. The secret is
shown once.

Then load credits in the developer console and set a spending limit. A sign-in
costs one user lookup at $0.010 and nothing else in this project calls X.

## Step 2. Push to GitHub

Create a repository and upload the contents of this folder with the structure
intact. If the files land flat instead of in folders, delete and upload again.

## Step 3. Connect Cloudflare Pages

Sign up at dash.cloudflare.com. No card required.

Workers & Pages → Create → **Pages** tab → Connect to Git → select the repo.

Build settings:

| Field                  | Value         |
| ---------------------- | ------------- |
| Framework preset       | None          |
| Build command          | `npm install` |
| Build output directory | `public`      |

Save and Deploy. You get an address like `form-no.pages.dev`. If it differs
from the callback URI you entered in step 1, correct it at X now.

## Step 4. Compatibility flag

Settings → Functions → Compatibility flags → add `nodejs_compat`.

The signing library needs it. Without the flag every function fails to start.

## Step 5. Variables and secrets

Settings → Variables and secrets. Add these as **plain text**:

```
SITE_URL     = https://form-no.pages.dev      no trailing slash
X_CLIENT_ID  = ...                            from step 1
```

And these as **Secret**, not text:

```
X_CLIENT_SECRET = from step 1
SESSION_SECRET  = any long random string you invent
PUBLISH_KEY     = another long random string, for phase two
```

`SESSION_SECRET` signs the sign-in cookie. Thirty or more random characters is
fine; changing it later signs everybody out, which is harmless.

## Step 6. Add the KV store

Storage & Databases → KV → Create instance → name it `form-no-store`.

Back in the project: Settings → Bindings → Add → KV namespace. The variable
name must be exactly `RATE`. Select the instance. Save.

Nothing works without this; it holds the filings themselves.

Then Deployments → Retry deployment, so the flag, the secrets and the binding
all take effect.

## Step 7. Test it

- "Sign in with X to file" should send you to X and bring you back signed in.
- The card should then read "Filing as @yourhandle".
- File a message. It should appear on the wall, numbered #0001, marked queued.
- Open its link. The filing should have a page of its own.
- Click your handle. Your record, with everything you have filed.
- File again. "You have filed today" means the limit is live.
- Put a link in a message. It should be refused.

**When something fails.** Sign-in bouncing back with an error usually means the
callback URI at X does not match `SITE_URL` exactly. A blank page means the
build output directory is not `public`. Nothing saving at all means the KV
binding is not named `RATE`, or the `nodejs_compat` flag is missing.

The site is now usable. Let people file.

---

# The contract

`contracts/NoWall.sol` holds a message nowhere. It checks the lengths, counts
the filing and emits a log. Everything the wall shows is read back from those
logs, and nothing in the contract can remove one.

Writing is limited to the relayer addresses the site signs with. The handle on
a filing is an assertion that its author signed in with X, and that check
happens off chain, so an open write would let anyone attach any handle to any
sentence. The owner keeps the writer list and can do nothing else: it cannot
write a filing, change one or delete one. Ownership moves in two steps, so a
mistyped address cannot strand the list.

Sequence numbers come from the contract's own counter rather than from the
caller, which is why they cannot repeat or skip. The filing time is passed in,
because a filing made while the queue was closed is written later than it was
made and the wall shows the moment it was made. The block timestamp stays on
the log for anyone who wants to compare the two.

## Running the tests

The suite needs no submodule and no package manager. On a fresh clone:

```
forge test -vv
```

Twenty-five tests cover the length limits at and over the boundary, the access
rules on both write paths, batch ordering and the batch cap, the all or nothing
behaviour when one entry in a batch is malformed, and the two-step handover of
ownership.

---

# Phase two: turn on the chain

Do this when there is enough on the wall to be worth paying for.

## Step 8. Two wallets

In MetaMask create **two new accounts**, used only for this project.

The first deploys the contract. Send it about $3 of ETH **on Robinhood Chain**
When withdrawing from an exchange, select Robinhood Chain, not Ethereum.

The second is the relayer. Send it about $20. Its private key goes into
Cloudflare, so it must hold nothing else. A filing costs roughly one to three
cents, so $20 covers 700 to 2,000 of them.

## Step 9. Deploy the contract

The constructor takes one argument: the **relayer** address from step 8. That
is the only address allowed to write filings. The wallet that signs the
deployment becomes the owner and is deliberately not made a writer, so the key
that controls the contract never has to sit on a server.

**From a browser.** On a desktop with MetaMask installed:

1. Open remix.ethereum.org.
2. Create `NoWall.sol` and paste in `contracts/NoWall.sol`.
3. Solidity Compiler → version 0.8.20 or newer → Compile.
4. Deploy & Run → Environment: **Injected Provider - MetaMask**.
5. Confirm it shows Custom (4663) and the **first** account from step 8.
6. Contract: `NoWall`. Paste the relayer address into the field beside the
   Deploy button, then Deploy and confirm.

**From a terminal**, if you have Foundry:

```
export RELAYER_ADDRESS=0x...
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --private-key $DEPLOYER_KEY \
  --broadcast
```

Leave off `--broadcast` to simulate it first without sending anything.

Copy the deployed address. Then confirm the writer took: calling `isWriter`
with the relayer address should return true, and `owner` should be the
deploying wallet.

## Step 10. Switch the chain on

Settings → Variables and secrets. Add as **plain text**:

```
CONTRACT = 0x...                        from step 9
RPC_URL  = https://rpc.mainnet.chain.robinhood.com
```

And as **Secret**:

```
RELAYER_KEY = the second wallet's private key
```

Never paste that key anywhere else. A Secret cannot be read back.

Redeploy. New filings now go to Robinhood Chain as they are made.

## Step 11. Send the queue up

Everything filed in phase one is still waiting. Publish it in batches, from a
terminal or any tool that can send a POST:

```
curl -X POST https://form-no.pages.dev/api/publish \
  -H "Content-Type: application/json" \
  -d '{"key":"YOUR_PUBLISH_KEY","limit":25}'
```

A batch travels in a single transaction, so the whole run either lands or does
not: the contract refuses the lot if one filing in it is malformed, and nothing
is marked written until the send comes back clean. The reply gives the
transaction hash, how many were written and how many remain. Run it again until
`remaining` is zero. The contract caps a batch at 100; twenty-five keeps the
request comfortably inside Cloudflare's time budget.

Check the transaction on Blockscout, then reload the wall: the "queued" markers
are gone and each filing links to it.

---

## Running it

**Hiding a filing.** Add its id, or its transaction hash, to the `hashes`
array in `public/hidden.json` and commit. It disappears from the wall and its
permalink returns 404. Once on Robinhood Chain the record is permanent; the site simply
stops showing it. This is the only moderation lever.

```json
{ "hashes": ["5f3a9c21b40e7d8a6c1b2e04"] }
```

**Limits.** One filing per X account per day, set by `DAILY_LIMIT` in
`functions/api/reject.js`. Signing and objecting are one per account per
filing, and signing your own filing is refused. Messages containing links,
domains, wallet addresses or chat invites are refused.

**Gas.** Watch the relayer balance. If the chain refuses a filing, for no gas or an RPC
that is down, the filing is kept and rejoins the queue rather than being lost, and the
publisher sends it later. Keeping the balance small is deliberate: it caps the
worst case.

**X costs.** Only the sign-in calls X, once, at $0.010. The handle is then kept
in a signed cookie for thirty days, so returning visitors cost nothing. Reading
the wall never calls X and needs no sign-in.

**Renaming on X.** Filings are tied to the X account id, not to the handle, so
somebody who renames keeps their whole record and their old links still work.
Each message keeps the handle it was written under, because that is what goes
on chain. The avatar and current handle are refreshed at every sign-in.

**What is stored about a person.** Their X handle, their X account number and
the link to their avatar, all collected in the single sign-in lookup. No email,
no token, no tweets. The access token is discarded as soon as the handle has
been read.

**Ceilings on the free tier.** Cloudflare allows 100,000 function requests and
1,000 KV writes a day. A filing costs about three writes, a signature two, a
sign-in two or three. That is roughly 150 filings plus 200 signatures in a day
before the limit bites. Past that, the $5 Workers paid plan raises it to a
million.

**One caveat worth knowing.** The filings live in a single stored list, read
and written whole. At this scale that is fine; if two people file in the very
same instant, one write can land on top of the other. If the wall ever gets
busy enough for that to matter, the list should move to a real database.
