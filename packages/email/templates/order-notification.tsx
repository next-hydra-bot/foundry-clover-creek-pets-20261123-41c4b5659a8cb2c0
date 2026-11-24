import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface OrderNotificationProps {
  readonly title: string;
  readonly introduction: string;
  readonly orderNumber: string;
  readonly orderUrl?: string;
  readonly orderLinkLabel?: string;
  readonly totalLabel: string;
  readonly total: string;
  readonly lines: readonly {
    readonly id: string;
    readonly name: string;
    readonly quantity: number;
    readonly amount?: string;
  }[];
  readonly tracking: readonly {
    readonly number?: string;
    readonly carrier?: string;
    readonly url?: string;
  }[];
}
export const OrderNotificationTemplate = (props: OrderNotificationProps) => (
  <Html>
    <Head />
    <Preview>
      {props.title} {props.orderNumber}
    </Preview>
    <Body
      style={{
        backgroundColor: "#f5f5f4",
        color: "#1c1917",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <Container
        style={{
          backgroundColor: "#fff",
          margin: "32px auto",
          maxWidth: "600px",
          padding: "32px",
        }}
      >
        <Heading>
          {props.title} {props.orderNumber}
        </Heading>
        <Text>{props.introduction}</Text>
        {props.orderUrl ? (
          <Text>
            <a href={props.orderUrl}>{props.orderLinkLabel ?? "View order"}</a>
          </Text>
        ) : null}
        <Section>
          {props.lines.map((line) => (
            <Text key={line.id}>
              {line.name} × {line.quantity}
              {line.amount ? ` — ${line.amount}` : ""}
            </Text>
          ))}
          <Text>
            <strong>
              {props.totalLabel}: {props.total}
            </strong>
          </Text>
        </Section>
        {props.tracking.map((item) => (
          <Text key={`${item.carrier}:${item.number}:${item.url}`}>
            {item.carrier}{" "}
            {item.url ? (
              <a href={item.url}>{item.number ?? item.url}</a>
            ) : (
              item.number
            )}
          </Text>
        ))}
      </Container>
    </Body>
  </Html>
);
