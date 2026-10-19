-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "autoMatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "firstPlayerSetting" TEXT,
ADD COLUMN     "maxMoves" INTEGER,
ADD COLUMN     "pieces" INTEGER;

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
