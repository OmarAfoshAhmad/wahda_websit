import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    const password = "Admin123";
    const hash = await bcrypt.hash(password, 10);

    await prisma.facility.update({
        where: { username: "admin" },
        data: {
            password_hash: hash,
            must_change_password: false
        }
    });

    console.log("Admin password reset to Admin123");
}

main().catch(console.error).finally(() => prisma.$disconnect());
