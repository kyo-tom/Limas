<?php

namespace Limas\Listener;

use Doctrine\Bundle\DoctrineBundle\EventSubscriber\EventSubscriberInterface;
use Doctrine\ORM\Event\OnFlushEventArgs;
use Doctrine\ORM\Events;
use Limas\Entity\Part;
use Limas\Entity\StockEntry;


class StockLevel
	implements EventSubscriberInterface
{
	public function getSubscribedEvents(): array
	{
		return [
			Events::onFlush
		];
	}

	public function onFlush(OnFlushEventArgs $eventArgs): void
	{
		$uow = $eventArgs->getObjectManager()->getUnitOfWork();

		$parts = [];

		foreach ($uow->getScheduledEntityInsertions() as $updated) {
			if (($updated instanceof StockEntry) && !in_array($updated->getPart(), $parts, true)) {
				$parts[] = $updated->getPart();
			}
		}

		foreach ($uow->getScheduledEntityUpdates() as $updated) {
			if (($updated instanceof StockEntry) && !in_array($updated->getPart(), $parts, true)) {
				$parts[] = $updated->getPart();
			}
		}

		foreach ($parts as $part) {
			if ($part !== null) {
				$this->updateStockLevel($part, $eventArgs);
			}
		}
	}

	protected function updateStockLevel(Part $part, OnFlushEventArgs $eventArgs): void
	{
		$entityManager = $eventArgs->getObjectManager();

		$part->recomputeStockLevels();

		$entityManager->getUnitOfWork()->recomputeSingleEntityChangeSet(
			$entityManager->getClassMetadata(get_class($part)),
			$part
		);
	}
}
