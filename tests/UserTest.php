<?php

namespace Limas\Tests;

use Doctrine\Common\DataFixtures\ReferenceRepository;
use Doctrine\ORM\EntityManagerInterface;
use Liip\FunctionalTestBundle\Test\WebTestCase;
use Liip\TestFixturesBundle\Services\DatabaseToolCollection;
use Limas\Entity\User;
use Limas\Exceptions\UserProtectedException;
use Limas\Service\UserPreferenceService;
use Limas\Service\UserService;
use Limas\Tests\DataFixtures\UserDataLoader;
use Nette\Utils\Json;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;


class UserTest
	extends WebTestCase
{
	protected ReferenceRepository $fixtures;
	protected UserPasswordHasherInterface $hasher;


	protected function setUp(): void
	{
		parent::setUp();
		$this->fixtures = $this->getContainer()->get(DatabaseToolCollection::class)->get()->loadFixtures([
			UserDataLoader::class
		])->getReferenceRepository();
		$this->hasher = $this->getContainer()->get(UserPasswordHasherInterface::class);
	}

	public function testCreateUser(): void
	{
		$client = static::makeAuthenticatedClient();

		$client->request(
			'POST',
			'/api/users',
			[],
			[],
			['CONTENT_TYPE' => 'application/json'],
			Json::encode([
				'username' => 'foobartest',
				'newPassword' => '1234'
			])
		);

		$response = Json::decode($client->getResponse()->getContent());

		self::assertEquals(201, $client->getResponse()->getStatusCode());
		self::assertEquals('foobartest', $response->{'username'});
//		self::assertEmpty($response->{'password'});
		self::assertObjectNotHasAttribute('newPassword', $response);
	}

	public function testChangeUserPassword(): void
	{
		$user = new User('bernd');
		$user->setPassword($this->hasher->hashPassword($user, 'admin'))
			->setProvider($this->getContainer()->get(UserService::class)->getBuiltinProvider());

		$this->getContainer()->get(EntityManagerInterface::class)->persist($user);
		$this->getContainer()->get(EntityManagerInterface::class)->flush($user);

		$client = static::makeAuthenticatedClient();

		$iri = '/api/users/' . $user->getId();

		$client->request('GET', $iri);

		$response = Json::decode($client->getResponse()->getContent());

		unset($response->password);
		$response->newPassword = 'foobar';

		$client->request(
			'PUT',
			$iri,
			[],
			[],
			[],
			Json::encode($response)
		);

		$response = Json::decode($client->getResponse()->getContent());

		self::assertEquals(200, $client->getResponse()->getStatusCode());
//		self::assertEmpty($response->{'password'});
		self::assertObjectNotHasAttribute('newPassword', $response);
	}

	public function testSelfChangeUserPassword(): void
	{
		$user = new User('bernd2');
		$user->setPassword($this->hasher->hashPassword($user, 'admin'))
			->setProvider($this->getContainer()->get(UserService::class)->getBuiltinProvider());

		$this->getContainer()->get(EntityManagerInterface::class)->persist($user);
		$this->getContainer()->get(EntityManagerInterface::class)->flush($user);

		$client = static::makeClientWithCredentials('bernd2', 'admin');

		$iri = '/api/users/' . $user->getId() . '/changePassword';

		$parameters = [
			'oldpassword' => 'admin',
			'newpassword' => 'foobar',
		];

		$client->request(
			'PATCH',
			$iri,
			[],
			[],
			['CONTENT_TYPE' => 'application/merge-patch+json'],
			Json::encode($parameters)
		);

		$response = Json::decode($client->getResponse()->getContent());

		self::assertEquals(200, $client->getResponse()->getStatusCode());
		self::assertObjectNotHasAttribute('password', $response);
//		self::assertEmpty($response->{'newPassword'});

		$client = static::makeClientWithCredentials('bernd2', 'foobar');

		$client->request(
			'PATCH',
			$iri,
			[],
			[],
			['CONTENT_TYPE' => 'application/merge-patch+json'],
			Json::encode($parameters)
		);

		$response = Json::decode($client->getResponse()->getContent());

		self::assertEquals(500, $client->getResponse()->getStatusCode());
		self::assertObjectHasAttribute('@type', $response);
		self::assertEquals('hydra:Error', $response->{'@type'});
	}

	public function testUserProtect(): void
	{
		$userService = $this->getContainer()->get(UserService::class);

		$user = $userService->getUser('fuuser', $userService->getBuiltinProvider(), true);

		$userService->protect($user);

		self::assertTrue($user->isProtected());

		$client = static::makeAuthenticatedClient();

		$iri = '/api/users/' . $user->getId();

		$client->request(
			'PUT',
			$iri,
			[],
			[],
			[],
			Json::encode([
				'username' => 'foo',
			])
		);

		$response = Json::decode($client->getResponse()->getContent());

		$exception = new UserProtectedException;
		self::assertEquals(500, $client->getResponse()->getStatusCode());
		self::assertObjectHasAttribute('hydra:description', $response);
		self::assertEquals($exception->getMessageKey(), $response->{'hydra:description'});

		$client->request('DELETE', $iri);

		$response = Json::decode($client->getResponse()->getContent());
		self::assertEquals(500, $client->getResponse()->getStatusCode());
		self::assertObjectHasAttribute('hydra:description', $response);
		self::assertEquals($exception->getMessageKey(), $response->{'hydra:description'});
	}

	public function testUserUnprotect(): void
	{
		$userService = $this->getContainer()->get(UserService::class);

		$user = $userService->getUser($this->fixtures->getReference('user.admin')->getUsername(), $userService->getBuiltinProvider(), true);

		$userService->unprotect($user);

		self::assertFalse($user->isProtected());
	}

	/**
	 * Tests the proper user deletion if user preferences exist
	 *
	 * Unit test for Bug #569
	 *
	 * @see https://github.com/partkeepr/PartKeepr/issues/569
	 */
	public function testUserWithPreferencesDeletion(): void
	{
		$client = static::makeAuthenticatedClient();

		$client->request(
			'POST',
			'/api/users',
			[],
			[],
			['CONTENT_TYPE' => 'application/json'],
			Json::encode([
				'username' => 'preferenceuser',
				'newPassword' => '1234',
			])
		);

		$userService = $this->getContainer()->get(UserService::class);

		$user = $userService->getUser('preferenceuser', $userService->getBuiltinProvider());

		$this->getContainer()->get(UserPreferenceService::class)->setPreference($user, 'foo', 'bar');

		$client->request('DELETE', '/api/users/' . $user->getId());

		self::assertEquals(204, $client->getResponse()->getStatusCode());
		self::assertEmpty($client->getResponse()->getContent());
	}
}
