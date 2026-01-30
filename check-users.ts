import { db } from "./server/db/drizzle";
import * as schema from "./server/db/schema/auth";
import { safeDecrypt } from "./server/auth/crypto";

async function main() {
    const users = await db.select().from(schema.users);
    console.log(`Found ${users.length} users:`);
    users.forEach(u => {
        console.log({
            id: u.id,
            email: safeDecrypt(u.email),
            emailHmac: u.emailHmac,
            isServerAdmin: u.isServerAdmin,
            isServerOwner: u.isServerOwner,
        });
    });
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
