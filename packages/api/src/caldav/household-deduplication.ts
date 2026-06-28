import type { UserCaldavConfigDecryptedDto } from "@norish/shared/contracts/dto/caldav-config";
import { getHouseholdCaldavConfigs } from "@norish/db/repositories/caldav-config";
import {
  getActiveHouseholdForUser,
  getHouseholdMemberIds,
} from "@norish/db/repositories/households";

/**
 * Get unique CalDAV servers for all household members
 * Returns a Map where key is serverUrl and value is the config to use
 */
export async function getUniqueCalDavServers(
  userId: string
): Promise<Map<string, UserCaldavConfigDecryptedDto>> {
  // Get all member IDs of the user's active household (including the user)
  const activeHousehold = await getActiveHouseholdForUser(userId);
  const householdUserIds = activeHousehold
    ? await getHouseholdMemberIds(activeHousehold.id)
    : [userId];

  // Get enabled CalDAV configs for all household members
  const configMap = await getHouseholdCaldavConfigs(householdUserIds);

  return configMap;
}
