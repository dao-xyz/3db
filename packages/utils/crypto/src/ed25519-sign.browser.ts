import sodium from "libsodium-wrappers";
import type { Ed25519Keypair, Ed25519PublicKey } from "./ed25519.js";
import { type PreHash, prehashFn } from "./prehash.js";
import { SignatureWithKey } from "./signature.js";

export const sign = async (
	data: Uint8Array,
	keypair: Ed25519Keypair,
	prehash: PreHash,
) => {
	const hashedData = await prehashFn(data, prehash);
	/* const init = sodium.crypto_sign_init()
	sodium.crypto_sign_update(init, hashedData)
	const signature = sodium.crypto_sign_final_create(init, keypair.privateKey.privateKey, 'uint8array') */
	return new SignatureWithKey({
		prehash,
		publicKey: keypair.publicKey,
		signature: sodium.crypto_sign_detached(
			hashedData,
			keypair.privateKeyPublicKey,
		),
	});
};

export const verifySignatureEd25519 = async (
	signature: SignatureWithKey,
	data: Uint8Array,
) => {
	let res = false;
	try {
		const hashedData = await prehashFn(data, signature.prehash);

		const verified = sodium.crypto_sign_verify_detached(
			signature.signature,
			hashedData,
			(signature.publicKey as Ed25519PublicKey).publicKey,
		);
		res = verified;
	} catch (error) {
		return false;
	}
	return res;
};
