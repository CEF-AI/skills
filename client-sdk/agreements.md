# Agreements — GAR (Global Agent Registry)

Agreements are signed contracts between a user and an agent service. They must be created before using most agent service features (events, streams, queries).

---

## Create Agreement

```typescript
const agreement = await sdk.agreement.create(
  'agent-service-pub-key',
  { metadata: { tier: 'premium' } },  // optional
  3600,                                 // TTL in seconds (optional, null = no expiry)
);
// Returns: { payload: 'base64url...', signature: { algorithm, signer, value } }
```

## Update Agreement

```typescript
const updated = await sdk.agreement.update(
  'agent-service-pub-key',
  { metadata: { tier: 'enterprise' } },
  7200,
);
```

## Revoke Agreement

```typescript
const revoked = await sdk.agreement.revoke('agent-service-pub-key');
```

---

## How Signing Works

1. Build a 6-field payload:
   ```typescript
   {
     agent_service_pub_key: string,
     user_pub_key: string,
     revoked: boolean,
     expires_at: string | null,    // RFC3339, from TTL
     metadata: Record<string, unknown>,
     created_at: string,           // RFC3339, replay protection
   }
   ```
2. JSON-serialize → UTF-8 bytes
3. Sign raw bytes with Ed25519 (`wallet.signRawBytes()`)
4. Base64url-encode the payload
5. POST `{ payload: base64url, signature: { algorithm: 'ed25519', signer, value: hex } }`

---

## Error Types

| Error | HTTP | When |
|-------|------|------|
| `AgreementAlreadyExistsError` | 409 | Create called but agreement exists |
| `AgreementNotFoundError` | 404 | Update/revoke but no agreement |
| `AgreementConflictError` | 409 | Update rejected (stale `created_at`) |
| `GarSignerRequiredError` | — | Wallet doesn't implement `signRawBytes` |
| `GarInvalidTtlError` | — | TTL is NaN, negative, or zero |

---

## Wallet Requirements

The wallet must implement `signRawBytes(bytes: Uint8Array): Promise<string>` for GAR operations. Standard `sign()` (used for events) is not sufficient — GAR needs Ed25519 over raw bytes, not over hex-encoded hashes.

```typescript
interface GarSignerCapable {
  signRawBytes(bytes: Uint8Array): Promise<string>; // hex-encoded signature
}
```

---

## GAR URL (v0.0.9+)

Since v0.0.9, `garUrl` is a first-class config option. **It's required** — calling any agreement method without `garUrl` throws:

```
Error: GAR is a separate service. Configure garUrl when creating the client for agreement operations.
```

```typescript
const sdk = new ClientSdk({
  url: 'https://cluster.cere.network',
  garUrl: 'https://gar.cere.network',  // ← required for agreements
  // ...
});
```

Agreements are sent to `{garUrl}/api/v1/agreements`. No nginx proxy workaround needed.
