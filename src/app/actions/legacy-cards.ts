"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getLegacyCardsAnalysisAction() {
  try {
    const legacyCards = await prisma.beneficiary.findMany({
      where: { is_legacy_card: true, deleted_at: null },
      select: {
        id: true,
        name: true,
        card_number: true,
        created_at: true,
        city: true,
      }
    });

    const allNames = legacyCards.map(c => c.name);

    const newCards = await prisma.beneficiary.findMany({
      where: {
        name: { in: allNames },
        is_legacy_card: false,
        deleted_at: null
      },
      select: {
        id: true,
        name: true,
        card_number: true,
        created_at: true,
        batch_number: true,
        city: true,
      }
    });

    const withNewCards: any[] = [];
    const withoutNewCards: any[] = [];

    legacyCards.forEach(legacy => {
      // Find a newer card for the same name
      const newerCard = newCards.find(
        n => n.name === legacy.name && new Date(n.created_at) > new Date(legacy.created_at)
      );

      if (newerCard) {
        withNewCards.push({
          legacy_id: legacy.id,
          name: legacy.name,
          legacy_card: legacy.card_number,
          new_card: newerCard.card_number,
          new_batch: newerCard.batch_number,
          legacy_date: legacy.created_at,
          new_date: newerCard.created_at,
          city: legacy.city || newerCard.city || null,
        });
      } else {
        withoutNewCards.push({
          legacy_id: legacy.id,
          name: legacy.name,
          legacy_card: legacy.card_number,
          legacy_date: legacy.created_at,
          city: legacy.city || null,
        });
      }
    });

    return {
      success: true,
      data: {
        withNewCards,
        withoutNewCards
      }
    };
  } catch (error: any) {
    console.error("Error in getLegacyCardsAnalysisAction:", error);
    return { success: false, error: error.message };
  }
}

export async function deleteLegacyCardAction(id: string) {
  try {
    // We soft-delete the record
    await prisma.beneficiary.update({
      where: { id },
      data: { deleted_at: new Date() }
    });
    revalidatePath("/admin/legacy-cards");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteAllUnusedLegacyCardsAction(ids: string[]) {
  try {
    await prisma.beneficiary.updateMany({
      where: { id: { in: ids } },
      data: { deleted_at: new Date() }
    });
    revalidatePath("/admin/legacy-cards");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
