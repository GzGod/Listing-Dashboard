import { PrismaClient } from "@prisma/client";
export { PrismaClient, Prisma } from "@prisma/client";
let client: PrismaClient | undefined;
export function getPrisma(): PrismaClient { return (client ??= new PrismaClient()); }
