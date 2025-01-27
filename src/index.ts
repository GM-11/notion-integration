import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();

export const notion = new Client({
  auth: process.env.NOTION_TOKEN!,
});

function getCurrentDateDetails() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.toLocaleString("default", { month: "long" }); // e.g., "October"
  const week = Math.ceil(now.getDate() / 7); // Calculate week number (1-4)
  const day = now.toLocaleString("default", { weekday: "long" }); // e.g., "Monday"
  return { year, month, week, day };
}

async function findPageInDatabase(
  databaseId: string,
  title: string,
  property: string
) {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: property,
      title: {
        equals: title,
      },
    },
  });
  return response.results[0];
}

async function addTaskToDayPage(
  dayPageId: string,
  dayName: string,
  taskName: string,
  reminderTime: string
) {
  const tasksDatabase = await findTasksDatabaseInDay(dayPageId, dayName);
  if (!tasksDatabase) {
    throw new Error("Tasks database not found in the day page.");
  }

  // Validate reminderTime format
  if (
    reminderTime &&
    !reminderTime.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/)
  ) {
    throw new Error(
      "Invalid reminderTime format. Must be ISO 8601 formatted string."
    );
  }

  const response = await notion.pages.create({
    parent: { database_id: tasksDatabase.id },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: taskName,
            },
          },
        ],
      },
      Done: {
        type: "checkbox",
        checkbox: false,
      },
      "Due Date": {
        type: "date",
        date: {
          start: reminderTime,
        },
      },
    },
  });

  if (!response) {
    throw new Error("Task creation failed.");
  }

  const propertyName = `${dayName} Tasks`;

  const existingProperties = (
    (await notion.pages.retrieve({
      page_id: dayPageId,
    })) as any
  ).properties[propertyName].relation;

  const relationResponse = await notion.pages.update({
    page_id: dayPageId,
    properties: {
      [`${dayName} Tasks`]: {
        relation: [
          {
            id: response.id,
          },
          ...existingProperties,
        ],
      },
    },
  });

  return relationResponse;
}

async function findWeekDatabaseInPage(page_id: string, week: number) {
  const weekDatabaseId = (
    await notion.blocks.children.list({
      block_id: page_id,
    })
  ).results.find(
    (block) => (block as any).child_database.title === `WEEK ${week}`
  )?.id;

  const weekDatabase = await notion.databases.retrieve({
    database_id: weekDatabaseId!,
  });

  return weekDatabase;
}

async function findTasksDatabaseInDay(page_id: string, day: string) {
  const dayDatabaseId = (
    await notion.blocks.children.list({
      block_id: page_id,
    })
  ).results.find(
    (block) => (block as any).child_database.title === `${day} Tasks`
  )?.id;

  const dayDatabase = await notion.databases.retrieve({
    database_id: dayDatabaseId!,
  });

  return dayDatabase;
}

async function addTaskForCurrentDate(taskName: string) {
  const { month, week, day } = getCurrentDateDetails();

  const monthPage = await findPageInDatabase(
    process.env.MONTHLY_DATA_DATABASE_ID!,
    month,
    "Name"
  );
  if (!monthPage) {
    throw new Error(`Month page for ${month} not found.`);
  }

  const weekDatabase = await findWeekDatabaseInPage(monthPage.id, week);
  if (!weekDatabase) {
    throw new Error(`Week ${week} database not found in ${month}.`);
  }

  const dayPage = await findPageInDatabase(weekDatabase.id, day, "Day");
  if (!dayPage) {
    throw new Error(`Day page for ${day} not found in Week ${week}.`);
  }

  const now = new Date();
  const sixPM = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    0,
    0
  );
  const time = sixPM.toISOString();

  const task = await addTaskToDayPage(dayPage.id, day, taskName, time);
  console.log("Task with reminder added successfully:", task);
}

addTaskForCurrentDate("Complete project report").catch((error) =>
  console.error("Error adding task:", error)
);
