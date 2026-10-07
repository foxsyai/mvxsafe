#!/usr/bin/env node
// OPS-11: mvxsafe.io publishes no CAA record.
//
// Without CAA any public CA will issue a certificate for mvxsafe.io to whoever
// can pass a domain validation, so a DNS or BGP hijack of a few minutes buys a
// valid certificate and, with it, a convincing copy of the signing interface.
// A CAA record limiting issuance to Let's Encrypt (the CA in use) costs one
// DNS entry at DigitalOcean and closes that for every other CA. DNSSEC is not
// enabled either (no RRSIG), which is noted, not tested: DigitalOcean DNS does
// not offer it.
//
// Read-only DNS lookup through Google's resolver (DoH), so it works wherever
// `dig` is not installed. Exit 1 when the domain has no CAA record, 0 otherwise.
//
//   node src/__audit__/ops/proofs/OPS-11-no-caa.mjs
const DOMAIN = process.env.DOMAIN || 'mvxsafe.io';

const lookup = async (name) => {
  const r = await fetch(`https://dns.google/resolve?name=${name}&type=CAA`, { headers: { accept: 'application/dns-json' } });
  const j = await r.json();
  return (j.Answer || []).filter((a) => a.type === 257).map((a) => a.data);
};

const records = await lookup(DOMAIN);
console.log(`CAA ${DOMAIN}: ${records.length ? records.join(' ; ') : '(none)'}`);
if (!records.length) {
  console.log('\nBUG (OPS-11): any CA may issue for the domain');
  process.exit(1);
}
console.log('\nOK: certificate issuance is restricted by CAA');
