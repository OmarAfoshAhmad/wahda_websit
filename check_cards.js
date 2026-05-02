const cardNumbers = ['WAB2025X', 'WAB2025XD1', 'WAB2025XD2', 'WAB2025XD3', 'WAB2025XF1', 'WAB2025XS1', 'WAB2025XS2', 'WAB2025XW1'];
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCardNumbers() {
  try {
    const results = await prisma.cardIssuanceRegistry.findMany({
      where: {
        card_number_upper: {
          in: cardNumbers
        }
      },
      select: {
        card_number_upper: true
      }
    });

    const foundCards = results.map(r => r.card_number_upper);
    const notFoundCards = cardNumbers.filter(card => !foundCards.includes(card));

    console.log('Found Cards:', foundCards);
    console.log('Not Found Cards:', notFoundCards);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCardNumbers();
