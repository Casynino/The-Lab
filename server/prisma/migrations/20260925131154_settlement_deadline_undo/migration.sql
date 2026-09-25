-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "deadlineBefore" TIMESTAMP(3),
ADD COLUMN     "deadlineChangeKind" TEXT,
ADD COLUMN     "deadlineChangedAt" TIMESTAMP(3),
ADD COLUMN     "deadlineChangedById" TEXT;

