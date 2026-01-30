
import { db } from "../server/db";
import { recipes } from "../server/db/schema";
import { eq } from "drizzle-orm";

async function analyze() {
    console.log("Fetching recipes...");
    const allRecipes = await db.query.recipes.findMany({
        with: {
            steps: true,
        },
    });

    console.log(`Analyzing ${allRecipes.length} recipes...`);

    let totalRecipes = allRecipes.length;
    let recipesWithTimers = 0;
    let totalTimerSteps = 0;
    let recipesWithMultipleTimers = 0;

    // Regex for finding durations (e.g. 5 mins, 1 hour, 30 seconds)
    // Simple regex: number followed by space and time unit
    const timeRegex = /\b(\d+(?:-\d+)?)\s*(min(?:ute)?s?|hr|hours?|sec(?:ond)?s?)\b/gi;

    const timerDistribution = {
        0: 0,
        1: 0,
        2: 0,
        3: 0,
        "4+": 0,
    };

    const sampleTimerSteps: string[] = [];

    for (const recipe of allRecipes) {
        let timerStepsCount = 0;

        for (const step of recipe.steps) {
            const matches = step.step.match(timeRegex);
            if (matches && matches.length > 0) {
                timerStepsCount++;
                totalTimerSteps++;
                if (sampleTimerSteps.length < 10) {
                    sampleTimerSteps.push(`[${recipe.name}] ${step.step}`);
                }
            }
        }

        if (timerStepsCount > 0) {
            recipesWithTimers++;
        }

        if (timerStepsCount > 1) {
            recipesWithMultipleTimers++;
        }

        if (timerStepsCount >= 4) {
            timerDistribution["4+"]++;
        } else {
            timerDistribution[timerStepsCount as keyof typeof timerDistribution]++;
        }
    }

    console.log("\n=== Timer Analysis Report ===");
    console.log(`Total Recipes: ${totalRecipes}`);
    console.log(`Recipes with at least one timer: ${recipesWithTimers} (${((recipesWithTimers / totalRecipes) * 100).toFixed(1)}%)`);
    console.log(`Recipes with multiple timer steps: ${recipesWithMultipleTimers} (${((recipesWithMultipleTimers / totalRecipes) * 100).toFixed(1)}%)`);
    console.log(`Total potential timer steps found: ${totalTimerSteps}`);

    console.log("\nDistribution of Timer Steps per Recipe:");
    console.table(timerDistribution);

    console.log("\nSample Timer Steps Found:");
    sampleTimerSteps.forEach(s => console.log(`- ${s}`));

    process.exit(0);
}

analyze().catch(console.error);
